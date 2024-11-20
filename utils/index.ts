import moment, { Moment } from "moment";
import { dates } from "./constants";
import {
  startOfDay,
  endOfDay,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";
import { AnalyticsFilterRange } from "../types";
import axios from "axios";
import { authString, Config } from "./config";
import { FundingWalletModel } from "../models/Wallet";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import bcrypt from "bcrypt";

// MONNIFY >>
export const MONNIFY = {
  // Encode the apiKey and clientSecret to base64
  authHeader: `Basic ${authString}`,
};
/**
 * Generates a random password of 8 characters long from a charset of alphanumeric characters.
 * @returns {string} - The generated password.
 */
export const generatePassword = () : string => {
  const length = 8;
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let generatedPassword = "";
  for (let i = 0, n = charset.length; i < length; ++i) {
    generatedPassword += charset.charAt(Math.floor(Math.random() * n));
  }
  return generatedPassword;
};

/**
 *
 * @returns {string} - Monnify access token
 * @description generate monnify access token >> used for monnify api calls authorization header
 */

export const generateMonnifyAccessToken = async () => {
  try {
    const response = await axios.post(
      `${Config.MONNIFY_API_URL_V1}/auth/login`,
      {},
      {
        headers: {
          Authorization: MONNIFY.authHeader,
        },
      }
    );

    return response.data.responseBody.accessToken;
  } catch (error) {
    console.error("Error generating Monnify access token: ", error);
    return null;
  }
};

export async function checkAccountNumberExists(
  accountNumber: string
): Promise<boolean> {
  const existingWallet = await FundingWalletModel.findOne({
    "accounts.accountNumber": accountNumber,
  });
  return !!existingWallet;
}

// << MONNIFY
// ensuring date data are free from manipulation by handling in the server
// and not from the client side > this is to prevent date manipulation by changing device date
export const generateYearDateRange = (
  fromDate: Date | string | Moment = dates.CURRENT_DATE_UTC,
  range: number = 1
) => {
  const startDate = moment(fromDate);
  const endDate = (startDate as Moment).clone().add(range, "year");

  return {
    startDate,
    endDate,
  };
};

/**
 *
 * @param filter analytics filter range e.g daily, weekly, monthly, yearly, custom
 * @param year year for custom filter > specifies the year to get data for
 * @param customStartDate custom start date for custom filter
 * @param customEndDate custom end date for custom filter
 * @returns {startDate, endDate} - date range for the specified filter
 */

export const getDateRange = (
  filter: AnalyticsFilterRange,
  year?: number,
  customStartDate?: Date,
  customEndDate?: Date
) => {
  let startDate: Date;
  let endDate: Date;

  switch (filter) {
    case AnalyticsFilterRange.DAILY:
      startDate = startOfDay(new Date());
      endDate = endOfDay(new Date());
      break;
    case AnalyticsFilterRange.YESTERDAY:
      startDate = startOfDay(subDays(new Date(), 1));
      endDate = endOfDay(subDays(new Date(), 1));
      break;
    case AnalyticsFilterRange.WEEKLY:
      startDate = startOfWeek(new Date());
      endDate = endOfWeek(new Date());
      break;
    case AnalyticsFilterRange.MONTHLY:
      startDate = startOfMonth(new Date());
      endDate = endOfMonth(new Date());
      break;
    case AnalyticsFilterRange.YEARLY:
      startDate = startOfYear(new Date());
      endDate = endOfYear(new Date());
      break;
    case AnalyticsFilterRange.CUSTOM:
      if (year) {
        startDate = startOfYear(new Date(year, 0, 1));
        endDate = endOfYear(new Date(year, 11, 31));
      } else 
      if (customStartDate && customEndDate) {
        startDate = startOfDay(customStartDate);
        endDate = endOfDay(customEndDate);
      } else {
        throw new Error(
          "Custom start date and end date are required for custom filter"
        );
      }
      break;
    case AnalyticsFilterRange.OVERALL:
      startDate = new Date(0); // Unix Epoch
      endDate = new Date();
      break;
    default:
      throw new Error("Invalid filter type");
  }

  return { startDate, endDate };
};

/**
 * Generates a unique reference for wallet transactions.
 * @returns {string} Unique reference string.
 */
export function generateUniqueReference(id?: string): string {
  const timestamp = Date.now(); // Current timestamp in milliseconds
  const uniqueId = uuidv4(); // Use the full UUID for better uniqueness
  const randomNum = Math.floor(Math.random() * 1000000); // Larger range for the random number
  return id
    ? `${id}-${timestamp}-${uniqueId}-${randomNum}`
    : `${timestamp}-${uniqueId}-${randomNum}`;
}


export function extractIdFromReference(reference: string): string | null {
  const parts = reference.split("-");
  return parts.length > 2 ? parts[0] : null;
}

/**
 *
 * @param unitCode the target vehicle unit's code
 * @param totalVehiclesInSameUnit the total number of vehicles in the same unit
 * @returns a unique identity code for the vehicle based on the unit code and the total number of vehicles in the same unit
 */

export const generateIdentityCode = (
  unitCode: string,
  totalVehiclesInSameUnit: number
) => {
    const totalVehicles = totalVehiclesInSameUnit + 1;

  return `${unitCode}${totalVehicles}`;
};

/**
 * Checks if a given date has expired.
 * @param {string | Date} expiryDate - The expiry date to check.
 * @returns {boolean} - Returns true if the date has expired, otherwise false.
 */
export const hasExpired = (expiryDate: string | Date): boolean => {
  const currentDate = new Date();
  const dateToCheck = new Date(expiryDate);
  return dateToCheck < currentDate;
};

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5MB
});

/**
 * Converts an image URL to a base64 string.
 * @param {string} url - The URL of the image to convert.
 * @returns {Promise<string>} - The base64 string of the image.
 */
export async function convertImageToBase64(url: string): Promise<string> {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const buffer = Buffer.from(response.data, "binary");
  return buffer.toString("base64");
}

const today = new Date();
const startOfToday = new Date(today.setHours(0, 0, 0, 0)); // Set time to start of the day

/**
 * Checks if the vehicle is owing tax.
 * @param {Date | null} taxPaidUntil - The date until which tax has been paid.
 * @param {Date} startOfToday - The start of today's date.
 * @returns {boolean} - Returns true if the vehicle is owing tax, otherwise false.
 */
export const isOwingTax = (taxPaidUntil: Date | null): boolean => {
  return taxPaidUntil !== null && taxPaidUntil < startOfToday;
};

/**
 * Calculates the number of days the vehicle is owing tax.
 * @param {Date | null} taxPaidUntil - The date until which tax has been paid.
 * @param {Date} startOfToday - The start of today's date.
 * @returns {number} - Returns the number of days the vehicle is owing tax.
 */
export const getDaysOwing = (taxPaidUntil: Date | null): number => {
  if (taxPaidUntil !== null && taxPaidUntil < startOfToday) {
    return Math.ceil(
      (startOfToday.getTime() - taxPaidUntil.getTime()) / (1000 * 60 * 60 * 24)
    );
  }
  return 0;
};


/**
 * Hashes the given data.
 * @param data The data to hash.
 * @returns The hashed data.
 */
export const hashData = async (data: string): Promise<string> => {
  return await bcrypt.hash(data, 10);
};