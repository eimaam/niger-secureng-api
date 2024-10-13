import { ClientSession } from "mongoose";
import InvoiceModel, { InvoiceStatusEnum } from "../models/Invoice";

export class InvoiceService {
  static async updateInvoiceStatus(
    invoiceReference: string,
    status: InvoiceStatusEnum,
    session?: ClientSession
  ) {
    const updatedInvoice = await InvoiceModel.findOneAndUpdate(
      { invoiceReference },
      { $set: { invoiceStatus: status } },
      { new: true, session }
    );

    if (!updatedInvoice) {
      throw new Error("Error updating invoice status");
    }

    return updatedInvoice;
  }
}
