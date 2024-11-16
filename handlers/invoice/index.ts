import { Request, Response } from "express";
import InvoiceModel, { InvoiceStatusEnum } from "../../models/Invoice";
import { Vehicle } from "../../models/Vehicle";
import { DriverModel } from "../../models/Driver";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { PaymentTypeModel } from "../../models/PaymentType";
import { PaymentTypeEnum } from "../../types";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { MonnifyService } from "../../services/monnify.wallet.service";

export class Invoices {
  static async getAll(req: Request, res: Response) {
    const userId = req.headers["userid"];

    const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
    const skip = Number(page - 1) * Number(limit);

    const query: any = {};

    if (req.query.createdBy) {
      query.createdBy = req.query.createdBy;
    }

    if (req.query.status) {
      query.invoiceStatus = req.query.status;
    }

    if (req.query.type) {
      const paymentType = await PaymentTypeModel.findOne({
        name: req.query.type as PaymentTypeEnum,
      });
      query.type = paymentType?._id;
    }

    if (req.query.customerEmail) {
      query.customerEmail = new RegExp(`^${req.query.customerEmail}$`, "i");
    }

    if (req.query.customerName) {
      query.customerName = new RegExp(`^${req.query.customerName}$`, "i");
    }

    if (req.query.invoiceReference) {
      query.invoiceReference = new RegExp(
        `^${req.query.invoiceReference}$`,
        "i"
      );
    }

    if (req.query.amount) {
      query.amount = req.query.amount; 
    }

    if (req.query.accountName) {
      query.accountName = new RegExp(`^${req.query.accountName}$`, "i");
    }

    if (req.query.accountNumber) {
      query.accountNumber = {$regex: `^${req.query.accountNumber}$`, $options: 'i'};
    }

    if (req.query.vehicleId) {
      query["metaData.vehicleId"] = req.query.vehicleId;
    }

    if (req.query.driverId) {
      query["metaData.driverId"] = req.query.driverId;
    }

    try {
      const invoices = await InvoiceModel.find(query)
        .populate({
          path: "type",
          select: "name",
        })
        .populate({
          path: "createdBy",
          select: "fullName email",
        })
        .skip(skip)
        .limit(limit)
        .lean()
        .sort({ createdAt: -1 });
      // Manually populate driver and vehicle
      for (const invoice of invoices) {
        if (invoice.metaData) {
          if ((invoice.metaData as any)?.vehicleId) {
            const vehicle = await Vehicle.findById(
              (invoice.metaData as any)?.vehicleId
            ).select(
              "identityCode chassisNumber licensePlateNumber owner.fullName owner.phoneNumber owner.email owner.nin"
            );
            (invoice.metaData as any).vehicle = vehicle;
          }
          if ((invoice.metaData as any)?.driverId) {
            const driver = await DriverModel.findById(
              (invoice.metaData as any)?.driverId
            ).select("fullName email phoneNumber nin associationNumber");
            (invoice.metaData as any).driver = driver;
          }
        }
      }

      const totalInvoices = await InvoiceModel.countDocuments(query);

      return res.status(200).json({
        success: true,
        message: "Invoices fetched successfully",
        page,
        totalPages: Math.ceil(totalInvoices / limit),
        totalInvoices,
        data: invoices,
      });
    } catch (error) {
      console.error("Error fetching invoices: ", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  static async cancel(req: Request, res: Response) {
    const { invoiceId } = req.params;
    const userId = req.headers["userid"];

    try {
      const invoice = await InvoiceModel.findById(invoiceId);

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // cancels invoice on monnify and updates invoice status to cancelled
      await MonnifyService.cancelInvoice(invoice.invoiceReference);

      return res.status(200).json({
        success: true,
        message: "Invoice cancelled successfully",
        data: invoice,
      });
    } catch (error) {
      console.error("Error cancelling invoice: ", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
}
