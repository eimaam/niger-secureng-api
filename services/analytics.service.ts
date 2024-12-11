import mongoose, { ClientSession } from "mongoose";
import {
  DownloadHistoryModel,
  ITransaction,
  TransactionModel,
} from "../models/Transaction";
import {
  AnalyticsFilterRange,
  PaymentStatusEnum,
  PaymentTypeEnum,
  VehicleStatusEnum,
  VehicleTypeEnum,
} from "../types";
import { getDateRange } from "../utils";
import { Vehicle } from "../models/Vehicle";
import InvoiceModel, { InvoiceStatusEnum } from "../models/Invoice";
import { PaymentTypeModel } from "../models/PaymentType";

export class AnalyticsService {
  // Assuming transactions is an array of all transactions in the system
  /**
   * Calculate the total revenue and daily revenue for a consultant
   * @param transactions The transactions to calculate revenue from - all transactions in the system
   * @param userId The id of the consultant to calculate revenue for
   * @param filterDate    The date to filter the daily revenue by
   * @returns The total revenue and daily revenue for the consultant
   */
  static async calculateRevenue(
    transactions: ITransaction[],
    userId: string,
    filterDate = null
  ) {
    let totalRevenue = 0;
    let dailyRevenue = 0;

    transactions.forEach((transaction) => {
      const consultantDetail = transaction.beneficiaries.find(
        (beneficiary: {
          userId: mongoose.Types.ObjectId; // Reference to User
          percentage: number; // Percentage of the total amount for the beneficiary in the tx
        }) => beneficiary.userId.equals(userId)
      );
      if (consultantDetail) {
        const revenueShare =
          (transaction.amount * consultantDetail.percentage) / 100;
        totalRevenue += revenueShare;

        // Check if the transaction date matches the filter date for daily revenue
        if (
          filterDate &&
          transaction.date.toISOString().split("T")[0] === filterDate
        ) {
          dailyRevenue += revenueShare;
        }
      }
    });

    return {
      dailyRevenue,
      total: totalRevenue,
    };
  }

  /**
   * Get the total number of successful transactions and revenue for a given date range
   * @param filter The filter to determine the date range
   * @param year The year to filter by (required for custom filter)
   * @param customStartDate The custom start date for the custom filter
   * @param customEndDate The custom end date for the custom filter
   * @returns The total number of successful transactions and revenue for the given date range
   * @throws Error if an error occurs while fetching the data
   */
  static async getOverallTotalTransactionsAndRevenue({
    filter = AnalyticsFilterRange.DAILY,
    year,
    customStartDate,
    customEndDate,
    session,
  }: {
    filter?: AnalyticsFilterRange;
    year?: number;
    customStartDate?: Date;
    customEndDate?: Date;
    session?: ClientSession;
  }) {
    const mongoSession = session || null;

    let totalTransactions = 0;
    let totalAmount = 0;

    try {
      const { startDate, endDate } = getDateRange(
        filter,
        year,
        customStartDate,
        customEndDate
      );

      const overallRevenue = await TransactionModel.aggregate([
        {
          $match: {
            date: {
              $gte: startDate,
              $lt: endDate,
            },
            status: PaymentStatusEnum.SUCCESSFUL,
          },
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
            totalTransactions: { $sum: 1 },
          },
        },
      ]).session(mongoSession);

      if (overallRevenue.length > 0) {
        totalTransactions = overallRevenue[0].totalTransactions;
        totalAmount = overallRevenue[0].totalAmount;
      }

      return {
        totalTransactions,
        totalAmount,
      };
    } catch (error) {
      throw new Error("An error occurred while fetching the data");
    }
  }

  /**
   * Get the total number of successful transactions and revenue for a given date range by user id
   * @param param0 {
   * filter The filter to determine the date range
   * year The year to filter by (required for custom filter)
   * customStartDate The custom start date for the custom filter
   * customEndDate The custom end date for the custom filter
   * userId The id of the user to filter by
   * session The current session
   * }
   * @returns
   */

  static async getOverallTotalTransactionsAndRevenueByUserId({
    filter = AnalyticsFilterRange.OVERALL,
    year,
    customStartDate,
    customEndDate,
    userId,
    session,
  }: {
    filter?: AnalyticsFilterRange;
    year?: number;
    customStartDate?: Date;
    customEndDate?: Date;
    userId: string;
    session?: ClientSession;
  }) {
    const mongoSession = session || null;

    let totalTransactions = 0;
    let totalAmount = 0;
    let dataPoints: any[] = [];

    try {
      const { startDate, endDate } = getDateRange(
        filter,
        year,
        customStartDate,
        customEndDate
      );

      const overallRevenue = await TransactionModel.aggregate([
        {
          $match: {
            date: {
              $gte: startDate,
              $lt: endDate,
            },
            status: PaymentStatusEnum.SUCCESSFUL,
          },
        },
        {
          $unwind: "$beneficiaries",
        },
        {
          $match: {
            "beneficiaries.userId": new mongoose.Types.ObjectId(userId),
          },
        },
        {
          $group: {
            _id: {
              day: { $dayOfMonth: "$date" },
              month: { $month: "$date" },
              year: { $year: "$date" },
            },
            totalAmount: {
              $sum: {
                $multiply: [
                  "$amount",
                  { $divide: ["$beneficiaries.percentage", 100] },
                ],
              },
            },
            totalTransactions: { $sum: 1 },
          },
        },
        {
          $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 },
        },
      ]).session(mongoSession);

      if (overallRevenue.length > 0) {
        totalTransactions = overallRevenue.reduce(
          (acc, curr) => acc + curr.totalTransactions,
          0
        );
        totalAmount = overallRevenue.reduce(
          (acc, curr) => acc + curr.totalAmount,
          0
        );
        dataPoints = overallRevenue.map((item) => ({
          date: new Date(
            Date.UTC(item._id.year, item._id.month - 1, item._id.day)
          ),
          totalAmount: item.totalAmount,
          totalTransactions: item.totalTransactions,
        }));
      }

      return {
        totalTransactions,
        totalAmount,
        dataPoints,
      };
    } catch (error) {
      throw new Error("An error occurred while fetching the data");
    }
  }

  /**
   * Get the total number of successful transactions and revenue for a given date range by payment type
   * @param param0  {
   * filter The filter to determine the date range
   * year The year to filter by (required for custom filter)
   * customStartDate The custom start date for the custom filter
   * customEndDate The custom end date for the custom filter
   * paymentType The payment type to filter by
   * session The current session
   * }
   * @returns the total number of successful transactions and revenue for the given date range
   */

  static async getOverallUserInvolvedTransactionsAndRevenue({
    filter = AnalyticsFilterRange.OVERALL,
    year,
    customStartDate,
    customEndDate,
    userId,
    session,
  }: {
    filter?: AnalyticsFilterRange;
    year?: number;
    customStartDate?: Date;
    customEndDate?: Date;
    userId: string;
    session?: ClientSession;
  }) {
    const mongoSession = session || null;

    let totalTransactions = 0;
    let totalAmount = 0;
    let dataPoints: any[] = [];

    try {
      const { startDate, endDate } = getDateRange(
        filter,
        year,
        customStartDate,
        customEndDate
      );

      const overallRevenue = await TransactionModel.aggregate([
        {
          $match: {
            date: {
              $gte: startDate,
              $lt: endDate,
            },
            status: PaymentStatusEnum.SUCCESSFUL,
            "beneficiaries.userId": new mongoose.Types.ObjectId(userId)
          },
        },
        {
          $unwind: "$beneficiaries",
        },
        {
          $match: {
            "beneficiaries.userId": new mongoose.Types.ObjectId(userId),
          },
        },
        {
          $group: {
            _id: {
              day: { $dayOfMonth: "$date" },
              month: { $month: "$date" },
              year: { $year: "$date" },
            },
            totalAmount: {
              $sum: "$amount",
            },
            totalTransactions: { $sum: 1 },
          },
        },
        {
          $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 },
        },
      ]).session(mongoSession);

      if (overallRevenue.length > 0) {
        totalTransactions = overallRevenue.reduce(
          (acc, curr) => acc + curr.totalTransactions,
          0
        );
        totalAmount = overallRevenue.reduce(
          (acc, curr) => acc + curr.totalAmount,
          0
        );
        dataPoints = overallRevenue.map((item) => ({
          date: new Date(
            Date.UTC(item._id.year, item._id.month - 1, item._id.day)
          ),
          totalAmount: item.totalAmount,
          totalTransactions: item.totalTransactions,
        }));
      }

      return {
        totalTransactions,
        totalAmount,
        dataPoints,
      };
    } catch (error) {
      throw new Error("An error occurred while fetching the data");
    }
  }

  //   get overall revenue based on payment type
  /**
   * Get the total number of successful transactions and revenue for a given date range by payment type
   * @param param0 {
   * filter The filter to determine the date range
   * year The year to filter by (required for custom filter)
   * customStartDate The custom start date for the custom filter
   * customEndDate The custom end date for the custom filter
   * paymentType The payment type to filter by
   * session The current session
   * @returns
   */
  static async getOverallTotalTransactionsAndRevenueByPaymentType({
    filter = AnalyticsFilterRange.OVERALL,
    year,
    customStartDate,
    customEndDate,
    paymentType,
    session,
  }: {
    filter?: AnalyticsFilterRange;
    year?: number;
    customStartDate?: Date;
    customEndDate?: Date;
    paymentType: PaymentTypeEnum;
    session?: ClientSession;
  }) {
    const mongoSession = session || null;

    let totalTransactions = 0;
    let totalAmount = 0;
    let dataPoints: any[] = [];

    try {
      const { startDate, endDate } = getDateRange(
        filter,
        year,
        customStartDate,
        customEndDate
      );

      const overallRevenue = await TransactionModel.aggregate([
        {
          $match: {
            date: {
              $gte: startDate,
              $lt: endDate,
            },
            status: PaymentStatusEnum.SUCCESSFUL,
            paymentType,
          },
        },
        {
          $group: {
            _id: {
              day: { $dayOfMonth: "$date" },
              month: { $month: "$date" },
              year: { $year: "$date" },
            },
            totalAmount: { $sum: "$amount" },
            totalTransactions: { $sum: 1 },
          },
        },
        {
          $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 },
        },
      ]).session(mongoSession);

      if (overallRevenue.length > 0) {
        totalTransactions = overallRevenue.reduce(
          (acc, curr) => acc + curr.totalTransactions,
          0
        );
        totalAmount = overallRevenue.reduce(
          (acc, curr) => acc + curr.totalAmount,
          0
        );
        dataPoints = overallRevenue.map((item) => ({
          date: new Date(
            Date.UTC(item._id.year, item._id.month - 1, item._id.day)
          ),
          totalAmount: item.totalAmount,
          totalTransactions: item.totalTransactions,
        }));
      }

      return {
        totalTransactions,
        totalAmount,
        dataPoints,
      };
    } catch (error) {
      throw new Error("An error occurred while fetching the data");
    }
  }

  //   get overall tax revenue
  static async getOverallTaxRevenueAndTransactions({
    filter = AnalyticsFilterRange.OVERALL,
    year,
    customStartDate,
    customEndDate,
    session,
  }: {
    filter?: AnalyticsFilterRange;
    year?: number;
    customStartDate?: Date;
    customEndDate?: Date;
    session?: ClientSession;
  }) {
    const mongoSession = session || null;

    let totalTaxRevenue = 0;
    let totalTransactions = 0;
    let dataPoints: any[] = [];

    // get the list of tax payment types to filter by and pass the ids to the query aggregation
    const taxPaymentTypes = await PaymentTypeModel.find({
      name: { $in: [
      PaymentTypeEnum.TRICYCLE,
      PaymentTypeEnum.OKADA,
      PaymentTypeEnum.JEGA,
      PaymentTypeEnum.OPEN_BODY,
      PaymentTypeEnum.SULEJA_TRICYCLE,
      PaymentTypeEnum.SULEJA_OKADA,
      PaymentTypeEnum.SULEJA_JEGA,
      PaymentTypeEnum.TAFA_TRICYCLE,
      PaymentTypeEnum.TAFA_OKADA,
      PaymentTypeEnum.TAXI
      ] }
    }).select('_id');

    const taxPaymentTypeIds = taxPaymentTypes.map(type => type._id);

    
    try {
      const { startDate, endDate } = getDateRange(
        filter,
        year,
        customStartDate,
        customEndDate
      );
      const overallRevenue = await TransactionModel.aggregate([
        {
          $match: {
            date: {
              $gte: startDate,
              $lt: endDate,
            },
            status: PaymentStatusEnum.SUCCESSFUL,
            type: { $in: taxPaymentTypeIds },
          },
        },
        {
          $group: {
            _id: {
              day: { $dayOfMonth: "$date" },
              month: { $month: "$date" },
              year: { $year: "$date" },
            },
            totalAmount: { $sum: "$amount" },
            totalTransactions: { $sum: 1 },
          },
        },
        {
          $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 },
        },
      ]).session(mongoSession);

      if (overallRevenue.length > 0) {
        totalTaxRevenue = overallRevenue.reduce(
          (acc, curr) => acc + curr.totalAmount,
          0
        );
        totalTransactions = overallRevenue.reduce(
          (acc, curr) => acc + curr.totalTransactions,
          0
        );
        dataPoints = overallRevenue.map((item) => ({
          date: new Date(
            Date.UTC(item._id.year, item._id.month - 1, item._id.day)
          ),
          totalAmount: item.totalAmount,
          totalTransactions: item.totalTransactions,
        }));
      }

      return {
        totalTaxRevenue,
        totalTransactions,
        dataPoints,
      };
    } catch (error) {
      throw new Error("An error occurred while fetching the data");
    }
  }

  //   Vehicles
  static async getTotalVehiclesByType(
    type?: VehicleTypeEnum,
    session?: ClientSession
  ) {
    const mongoSession = session || null;

    try {
      const totalVehicles = await Vehicle.find(
        type ? { vehicleType: type } : {}
      )
        .countDocuments()
        .session(mongoSession);

      return totalVehicles;
    } catch (error) {
      throw new Error("An error occurred while fetching the data");
    }
  }

  //   get total vehicles by status
  static async getTotalVehiclesByStatus(
    status: VehicleStatusEnum,
    session?: ClientSession
  ) {
    const mongoSession = session || null;

    try {
      const totalVehicles = await Vehicle.find({
        status,
      })
        .countDocuments()
        .session(mongoSession);

      return totalVehicles;
    } catch (error) {
      throw new Error("An error occurred while fetching the data");
    }
  }

  static async getTotalInvoicesCreatedByUser({
    filter = AnalyticsFilterRange.OVERALL,
    year,
    customStartDate,
    customEndDate,
    userId,
    status,
    session,
  }: {
    filter?: AnalyticsFilterRange;
    year?: number;
    customStartDate?: Date;
    customEndDate?: Date;
    userId: string;
    status?: InvoiceStatusEnum;
    session?: ClientSession;
  }) {
    const mongoSession = session ?? null;

    let totalInvoices = 0;
    let dataPoints: any[] = [];

    try {
      const { startDate, endDate } = getDateRange(
        filter,
        year,
        customStartDate,
        customEndDate
      );

      const overallInvoices = await InvoiceModel.aggregate([
        {
          $match: {
            date: {
              $gte: startDate,
              $lt: endDate,
            },
            createdBy: new mongoose.Types.ObjectId(userId),
            ...(status ? { invoiceStatus: status } : {}),
          },
        },
        {
          $group: {
            _id: {
              day: { $dayOfMonth: "$date" },
              month: { $month: "$date" },
              year: { $year: "$date" },
            },
            totalInvoices: { $sum: 1 },
          },
        },
        {
          $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 },
        },
      ]).session(mongoSession);

      if (overallInvoices.length > 0) {
        totalInvoices = overallInvoices.reduce(
          (acc, curr) => acc + curr.totalInvoices,
          0
        );
        dataPoints = overallInvoices.map((item) => ({
          date: new Date(
            Date.UTC(item._id.year, item._id.month - 1, item._id.day)
          ),
          totalInvoices: item.totalInvoices,
        }));
      }

      return {
        totalInvoices,
        dataPoints,
      };
    } catch (error) {
      throw new Error("An error occurred while fetching the data");
    }
  }

  static async getTotalInvoicesByStatus(
    status: PaymentStatusEnum,
    session?: ClientSession
  ) {
    const mongoSession = session ?? null;

    try {
      const totalInvoices = await InvoiceModel.find({
        status,
      })
        .countDocuments()
        .session(mongoSession);

      return totalInvoices;
    } catch (error) {
      throw new Error("An error occurred while fetching the data");
    }
  }

  static async getTotalPrintsAndDownloadsByUser({
    filter = AnalyticsFilterRange.OVERALL,
    year,
    customStartDate,
    customEndDate,
    userId,
    session,
  }: {
    filter?: AnalyticsFilterRange;
    year?: number;
    customStartDate?: Date;
    customEndDate?: Date;
    userId: string;
    session?: ClientSession;
  }) {
    const mongoSession = session ?? null;

    let total = 0;
    let dataPoints: any[] = [];

    try {
      const { startDate, endDate } = getDateRange(
        filter,
        year,
        customStartDate,
        customEndDate
      );

      const overallPrintsAndDownloads = await DownloadHistoryModel.aggregate([
        {
          $match: {
            date: {
              $gte: startDate,
              $lt: endDate,
            },
            processedBy: new mongoose.Types.ObjectId(userId),
          },
        },
        {
          $group: {
            _id: {
              day: { $dayOfMonth: "$date" },
              month: { $month: "$date" },
              year: { $year: "$date" },
            },
            totalCount: { $sum: 1 },
          },
        },
        {
          $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 },
        },
      ]).session(mongoSession);

      if (overallPrintsAndDownloads.length > 0) {
        total = overallPrintsAndDownloads.reduce(
          (acc, curr) => acc + curr.totalCount,
          0
        );
        dataPoints = overallPrintsAndDownloads.map((item) => ({
          date: new Date(
            Date.UTC(item._id.year, item._id.month - 1, item._id.day)
          ),
          totalPrints: item.totalPrints,
          totalDownloads: item.totalDownloads,
        }));
      }

      return {
        total,
        dataPoints,
      };
    } catch (error) {
      throw new Error("An error occurred while fetching the data");
    }
  }
}
