import { generateMonnifyAccessToken, generateUniqueReference } from "../utils";
import axios from "axios";
import { Config } from "../utils/config";
import mongoose, { ClientSession, isValidObjectId } from "mongoose";
import { FundingWalletModel } from "../models/Wallet";
import { Request, Response } from "express";
import MonnifySupportedBankModel from "../models/MonnifySupportedBank";
import InvoiceModel, { IInvoice, InvoiceStatusEnum } from "../models/Invoice";
import moment from "moment";

export interface IMonnifyTransaction {
  amount: number;
  reference: string;
  narration: string;
  destinationBankCode: string;
  destinationAccountNumber: string;
  currency: string;
  async?: boolean;
}
export interface IMonnifySingleTransferDetail extends IMonnifyTransaction {
  sourceAccountNumber: string;
}

export interface IMonnifyBulkTransferDetail {
  title: string;
  batchReference: string;
  narration: string;
  sourceAccountNumber: string;
  onValidationFailure: string;
  notificationInterval: number;
  transactionList: IMonnifyTransaction[];
}

export interface IInvoiceData {
  type: string;
  amount: number;
  invoiceReference?: string;
  description: string;
  customerEmail: string;
  customerName: string;
  expiryDate?: Date;
  metaData?: object;
  createdBy: string;
}

export class MonnifyService {
  /**
   *
   * @param userId The user ID to reserve account for
   * @param fullName The full name of the user
   * @param email Email of the user
   * @param limitProfileCode monnify account limit profile code
   * @returns The reserved accounts details with an "accounts" field as array of the various bank accounts generated
   */
  static async reserveAccount(
    userId: string,
    fullName: string,
    email: string,
    limitProfileCode?: string
  ) {
    if (!isValidObjectId(userId)) {
      throw new Error("Invalid user ID");
    }

    if (!fullName || !email) {
      throw new Error("Full name and email are required");
    }

    try {
      const accessToken = await generateMonnifyAccessToken();

      if (!accessToken) {
        throw new Error("Error generating access token");
      }

      const data = {
        accountReference: userId,
        accountName: fullName,
        currencyCode: "NGN",
        contractCode: Config.MONNIFY_CONTRACT_CODE,
        customerEmail: email,
        customerName: fullName,
        getAllAvailableBanks: false, // set to 'true' to disabled account creation from all banks and only use the specified banks in the preferredBanks array below
        // Bank codes > This selects banks for the virtual account creation. MoniePoint, Wema Bank, Sterling Bank
        ...(limitProfileCode ? { limitProfileCode } : {}),
        preferredBanks: ["50515", "035", "232"],
      };

      const result = await axios.post(
        limitProfileCode
          ? `${Config.MONNIFY_API_URL_V2}/bank-transfer/reserved-accounts/limit`
          : `${Config.MONNIFY_API_URL_V2}/bank-transfer/reserved-accounts`,
        data,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }
      );

      return result?.data?.responseBody;
    } catch (error) {
      console.error("Error reserving account: ", error);
      return null;
    }
  }

  static async getByOwnerId(userId: string, session?: ClientSession) {
    if (!isValidObjectId(userId)) {
      throw new Error("Invalid user ID");
    }

    try {
      const mongoSession = session ?? null;
      const wallet = await FundingWalletModel.findOne({ owner: userId }, null, {
        session: mongoSession,
      });
      return wallet;
    } catch (error) {
      throw new Error("Error fetching wallet");
    }
  }

  // Function to verify transaction status on Monnify
  static async verifyTransactionStatus(transactionReference: string) {
    const encodedTransactionReference =
      encodeURIComponent(transactionReference);

    const accessToken = await generateMonnifyAccessToken();

    const url = `${Config.MONNIFY_API_URL_V2}/transactions/${encodedTransactionReference}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return response.data.responseBody.paymentStatus;
  }

  /**
   * Creates a Limit Profile on Monnify and returns the limitProfileCode.
   *
   * @param {string} limitProfileName - Name of the limit profile.
   * @param {number} singleTransactionValue - Maximum amount allowed per transaction.
   * @param {number} dailyTransactionVolume - Maximum number of transactions allowed per day.
   * @param {number} dailyTransactionValue - Maximum total amount allowed per day.
   * @returns {Promise<string>} - The limitProfileCode for the created limit profile.
   */
  static async createLimitProfile(
    limitProfileName: string,
    singleTransactionValue: number,
    dailyTransactionVolume: number,
    dailyTransactionValue: number
  ) {
    const url = `${Config.MONNIFY_API_URL_V1}/limit-profile/`;

    // Generate an access token
    const token = await generateMonnifyAccessToken();

    // Define the request body
    const requestBody = {
      limitProfileName,
      singleTransactionValue,
      dailyTransactionVolume,
      dailyTransactionValue,
    };

    try {
      // Make the POST request
      const response = await axios.post(url, requestBody, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      // Return the limit profile code
      return response.data.responseBody?.limitProfileCode;
    } catch (error: any) {
      console.error(
        "Error creating limit profile:",
        error.response ? error.response.data : error.message
      );
      throw error;
    }
  }

  static async getBankDetailsByCode(bankCode: string, session?: ClientSession) {
    try {
      const bank = await MonnifySupportedBankModel.findOne(
        { code: bankCode },
        null,
        {
          session,
        }
      );

      return bank;
    } catch (error) {
      console.error("Error fetching bank details: ", error);
      return null;
    }
  }

  static async getSupportedBanks() {
    try {
      const accessToken = await generateMonnifyAccessToken();

      if (!accessToken) {
        throw new Error("Error generating access token");
      }

      const result = await axios.get(`${Config.MONNIFY_API_URL_V1}/banks`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      return result?.data?.responseBody;
    } catch (error) {
      console.error("Error fetching supported banks: ", error);
      return null;
    }
  }

  static async getAndUpdateSupportedBanks(_req: Request, res: Response) {
    try {
      const accessToken = await generateMonnifyAccessToken();

      if (!accessToken) {
        throw new Error("Error generating access token");
      }

      const result = await axios.get(`${Config.MONNIFY_API_URL_V1}/banks`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      const banks = result?.data?.responseBody;

      if (!banks || !Array.isArray(banks)) {
        throw new Error("Invalid response from Monnify API");
      }

      // Clear existing banks
      await MonnifySupportedBankModel.deleteMany({});

      // Insert new banks
      const bankDocuments = banks.map((bank: any) => ({
        name: bank.name,
        code: bank.code,
        ussdTemplate: bank.ussdTemplate || null,
        baseUssdCode: bank.baseUssdCode || null,
        transferUssdTemplate: bank.transferUssdTemplate || null,
        bankId: bank.bankId || null,
        nipBankCode: bank.nipBankCode,
      }));

      await MonnifySupportedBankModel.insertMany(bankDocuments);

      return res.status(200).json({
        success: true,
        message: "Supported banks fetched successfully",
        data: banks,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching supported banks",
        error: error.message,
      });
    }
  }

  static async initiateSingleTransfer(
    amount: number,
    accountNumber: string,
    bankCode: string,
    reference: string,
    narration: string
  ) {
    const accessToken = await generateMonnifyAccessToken();
    const url = `${Config.MONNIFY_API_URL_V2}/disbursements/single`;

    const data: IMonnifySingleTransferDetail = {
      amount,
      reference,
      narration,
      destinationBankCode: bankCode,
      destinationAccountNumber: accountNumber,
      currency: "NGN",
      sourceAccountNumber: Config.MONNIFY_WALLET_ACCT_NUMBER as string,
    };

    try {
      const response = await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.data?.requestSuccessful === true) {
        return response.data?.responseBody;
      }

      return null;
    } catch (error) {
      console.error("Error initiating transfer: ", error);
      return null;
    }
  }

  static async initiateBulkTransfer(transactions: IMonnifyTransaction[]) {
    const accessToken = await generateMonnifyAccessToken();
    const url = `${Config.MONNIFY_API_URL_V2}/disbursements/batch`;

    const data: IMonnifyBulkTransferDetail = {
      title: "SecureNG Earnings Payment",
      batchReference: generateUniqueReference(),
      narration: `${Date.now()} - SecureNG Earnings Payment`,
      sourceAccountNumber: Config.MONNIFY_WALLET_ACCT_NUMBER as string,
      onValidationFailure: "CONTINUE",
      notificationInterval: 25,
      transactionList: transactions,
    };

    try {
      const response = await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.data?.requestSuccessful === true) {
        return response.data?.responseBody;
      }

      return null;
    } catch (error: any) {
      console.error("Error initiating bulk transfer: ", error?.data);

      if (
        error?.response?.responseCode === "D07" ||
        error?.response?.data?.responseMessage ==
          "Transaction not awaiting authorization"
      ) {
        throw {
          message: "Duplicate transaction. Try again in few minutes...",
          code: "400",
        };
      }

      return null;
    }
  }

  /**
   * Creates an invoice on Monnify and saves the invoice details in the database
   * @param invoiceData - The invoice data
   * @param session - The MongoDB session to use
   * @returns The created invoice
   * @throws Error if the user ID is invalid
   * @throws Error if the invoice type is invalid
   * @throws Error if the invoice type is not provided
   */
  static async createInvoice(
    invoiceData: IInvoiceData,
    session?: ClientSession
  ) {
    // validate user id
    if (!isValidObjectId(invoiceData.createdBy)) {
      throw new Error("Invalid user ID");
    }

    const accessToken = await generateMonnifyAccessToken();
    const url = `${Config.MONNIFY_API_URL_V1}/invoice/create`;

    if (!accessToken) {
      throw new Error("Error generating access token");
    }

    if (!invoiceData.type) {
      throw new Error("Invoice type is required");
    }

    if (!isValidObjectId(invoiceData.type)) {
      throw new Error("Invalid invoice type");
    }

    try {
      const data = {
        amount: Number(invoiceData?.amount),
        invoiceReference: generateUniqueReference(),
        description: invoiceData?.description,
        currencyCode: "NGN",
        contractCode: Config.MONNIFY_CONTRACT_CODE,
        customerEmail: invoiceData?.customerEmail,
        customerName: invoiceData?.customerName,
        expiryDate: moment()
          .add(Config.INVOICE_EXPIRY_DAYS, "days")
          .format("YYYY-MM-DD HH:mm:ss"),
        paymentMethods: [],
        metaData: invoiceData?.metaData,
      };

      const response = await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      let invoice;

      if (response.data?.requestSuccessful === true) {
        const invoiceInfo = response.data?.responseBody;

        invoice = await InvoiceModel.create(
          [
            {
              type: invoiceData.type,
              ...data,
              accountName: invoiceInfo.accountName,
              accountNumber: invoiceInfo.accountNumber,
              bankName: invoiceInfo.bankName,
              invoiceStatus: invoiceInfo.invoiceStatus as InvoiceStatusEnum,
              createdBy: invoiceData.createdBy,
            },
          ],
          {
            session,
          }
        );
      }

      return invoice;
    } catch (error) {
      console.error("Error creating invoice: ", error);
      return null;
    }
  }

  /**
   * Cancels an invoice on Monnify and updates the invoice status in the database
   * @param invoiceReference - The reference of the invoice to cancel
   * @param session - The MongoDB session to use
   * @returns The updated invoice
   * @throws Error if the invoice reference is not provided
   * @throws Error if there is an error cancelling the invoice
   * @throws Error if there is an error generating the Monnify access token
   * @throws Error if the request is not successful
   */
  static async cancelInvoice(
    invoiceReference: string,
    session?: ClientSession
  ) {
    if (!invoiceReference) {
      throw new Error("Invoice reference is required");
    }

    const accessToken = await generateMonnifyAccessToken();
    const url = `${Config.MONNIFY_API_URL_V1}/invoice/${invoiceReference}/cancel`;

    if (!accessToken) {
      throw new Error("Error generating access token");
    }

    try {
      const response = await axios.delete(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      let invoice;

      if (response.data?.requestSuccessful === true) {
        invoice = await InvoiceModel.findOneAndUpdate(
          { invoiceReference },
          { invoiceStatus: InvoiceStatusEnum.CANCELLED },
          {
            session,
          }
        );

        if (!invoice) {
          throw new Error("Invoice not found");
        }
      }

      return invoice;
    } catch (error) {
      console.error("Error cancelling invoice: ", error);
      return null;
    }
  }

  static async getAllInvoices() {
    const accessToken = await generateMonnifyAccessToken();
    const url = `${Config.MONNIFY_API_URL_V1}/invoice/all`;

    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data?.responseBody;
    } catch (error) {
      console.error("Error getting all invoices: ", error);
      return null;
    }
  }

  static async resendOtp(reference: string) {
    const accessToken = await generateMonnifyAccessToken();
    const url = `${Config.MONNIFY_API_URL_V2}/disbursements/single/resend-otp`;

    const data = {
      reference,
    };

    try {
      const response = await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.data?.requestSuccessful === true) {
        return response.data?.responseBody;
      }

      return null;
    } catch (error: any) {
      console.error("Error resending OTP: ", error);

      if (
        error?.response?.responseCode === "D02" ||
        error?.response?.data?.responseMessage ==
          "Could not find disbursement transaction for given reference"
      ) {
        throw new Error("Transaction not found");
      }

      return null;
    }
  }

  static async verifySingleTransferOtp(reference: string, otp: string) {
    const accessToken = await generateMonnifyAccessToken();
    const url = `${Config.MONNIFY_API_URL_V2}/disbursements/single/validate-otp`;

    const data = {
      reference,
      authorizationCode: otp,
    };

    try {
      const response = await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.data?.requestSuccessful === true) {
        return response.data?.responseBody;
      }

      return null;
    } catch (error: any) {
      console.error("Error verifying transfer OTP: ", error?.response?.data);

      if (
        error?.response?.responseCode === "94" ||
        error?.response?.data?.responseMessage ==
          "Authorization code has expired"
      ) {
        throw new Error("Authorization code has expired");
      }

      // invalid otp error
      if (
        error?.response?.responseCode === "99" ||
        error?.responseCode === "95" ||
        error?.response?.data?.responseMessage ==
          "authorizationCode must be 6 digits" ||
        error?.response?.data?.responseMessage == "Invalid authorization code"
      ) {
        throw new Error("Invalid OTP");
      }

      if (
        error?.response?.responseCode === "D01" ||
        error?.response?.data?.responseMessage ==
          "Transaction not awaiting authorization"
      ) {
        throw new Error("Transaction not awaiting authorization");
      }

      return null;
    }
  }

  static async verifyBulkTransferOtp(reference: string, otp: string) {
    const accessToken = await generateMonnifyAccessToken();
    const url = `${Config.MONNIFY_API_URL_V2}/disbursements/batch/validate-otp`;

    const data = {
      reference,
      authorizationCode: otp,
    };

    try {
      const response = await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.data?.requestSuccessful === true) {
        return response.data?.responseBody;
      }

      return null;
    } catch (error: any) {
      console.error("Error verifying transfer OTP: ", error?.response?.data);
      // invalid otp error
      if (
        error?.response?.data?.responseCode == "99" ||
        error?.response?.data?.responseCode === "95" ||
        error?.response?.data?.responseMessage ==
          "authorizationCode must be 6 digits" ||
        error?.response?.data?.responseMessage == "Invalid authorization code"
      ) {
        throw {
          message: "Invalid OTP",
          code: "400",
        };
      }

      if (
        error?.response?.responseCode === "D01" ||
        error?.response?.data?.responseMessage ==
          "Transaction not awaiting authorization"
      ) {
        throw new Error("Transaction not awaiting authorization");
      }

      if (
        error?.response?.responseCode === "D02" ||
        error?.response?.data?.responseMessage ==
          "No transaction batch with specified reference"
      ) {
        throw new Error("No transaction found. Invalid Reference");
      }

      return null;
    }
  }
}
