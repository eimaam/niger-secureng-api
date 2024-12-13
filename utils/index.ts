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
import crypto from "crypto";
import sharp from "sharp";

// MONNIFY >>
export const MONNIFY = {
  // Encode the apiKey and clientSecret to base64
  authHeader: `Basic ${authString}`,
};
/**
 * Generates a random password of 8 characters long from a charset of alphanumeric characters.
 * @returns {string} - The generated password.
 */
export const generatePassword = (): string => {
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
      } else if (customStartDate && customEndDate) {
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
  const timestamp = Date.now().toString(36); // Base-36 encoded timestamp

  const micro = process.hrtime()[1].toString(36); // Microseconds for extra precision

  const uuid = uuidv4().replace(/-/g, "").substring(0, 8); // Short UUID segment

  const random = crypto.randomBytes(4).toString("hex"); // 8 chars of randomness

  let reference = `${timestamp}-${micro}-${uuid}-${random}`;

  if (id) {
    // Add `id` ensuring total length does not exceed 64

    const maxIdLength = 64 - reference.length - 1; // Account for `-`

    const truncatedId = id.substring(0, maxIdLength);

    reference = `${truncatedId}-${reference}`;
  }

  return reference.substring(0, 64); // Ensure final output is at most 64 characters
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

  const mimeType =
    response.headers["content-type"] || "application/octet-stream";

  const base64 = buffer.toString("base64") as string;

  return `data:${mimeType};base64,${base64}`;
}

const MAX_IMAGE_SIZE = 3 * 1024 * 1024; // 3MB in byte
const MAX_IMAGE_DIMENSION = 1000; // Maximum dimension (1000px)

// Fetch the image and check its size
async function fetchImage(imageUrl: string): Promise<Buffer | null> {
  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  } catch (error) {
    console.error("Error fetching image:", error);
    return null;
  }
}

// Compress and convert the image to Base64
export async function compressAndConvertToBase64(imageUrl: string): Promise<string | null> {
  const imageBuffer = await fetchImage(imageUrl);

  if (!imageBuffer) return null;

  try {
    // Compress the image using sharp, resizing to a maximum of 1000x1000 pixels
    const compressedImageBuffer = await sharp(imageBuffer)
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
        fit: 'inside', // Ensures the image fits within the given dimensions
        withoutEnlargement: true, // Prevents enlarging small images
      })
      .webp({ quality: 80 }) // Compresses image to WebP format with 80% quality (you can choose other formats like JPEG or PNG)
      .toBuffer();

    // Convert to Base64
    return `data:image/webp;base64,${compressedImageBuffer.toString('base64')}`;
  } catch (error) {
    console.error("Error compressing image:", error);
    return null;
  }
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
 * Calculates the number of days the vehicle is owing tax, excluding Sundays.
 * @param {Date | null} taxPaidUntil - The date until which tax has been paid.
 * @param {Date | null} dateSetInactive - The date when vehicle was set inactive.
 * @returns {number} - Returns the number of days the vehicle is owing tax.
 */
export const getDaysOwing = (
  taxPaidUntil: Date | null,
  dateSetInactive: Date | null
): number => {
  const startOfToday = moment().tz("Africa/Lagos").startOf("day");

  if (!taxPaidUntil || taxPaidUntil >= startOfToday.toDate()) {
    return 0;
  }

  let adjustedTaxPaidUntil = moment(taxPaidUntil).tz("Africa/Lagos");

  if (dateSetInactive) {
    const inactiveDays = moment()
      .tz("Africa/Lagos")
      .diff(moment(dateSetInactive).tz("Africa/Lagos"), "days");
    adjustedTaxPaidUntil = adjustedTaxPaidUntil.add(inactiveDays, "days");
  }

  let daysOwing = 0;
  let currentDate = moment(adjustedTaxPaidUntil).tz("Africa/Lagos");

  while (currentDate.isBefore(startOfToday)) {
    if (currentDate.day() !== 0) {
      // 0 represents Sunday
      daysOwing++;
    }
    currentDate.add(1, "days");
  }

  return daysOwing;
};

export const hasPaidForToday = (taxPaidUntil: Date | null): boolean => {
  return taxPaidUntil !== null && taxPaidUntil >= startOfToday;
};

/**
 * Hashes the given data.
 * @param data The data to hash.
 * @returns The hashed data.
 */
export const hashData = async (data: string): Promise<string> => {
  return await bcrypt.hash(data, 10);
};

/**
 * Adds a specified number of non-Sunday days to a date
 * @param startDate The starting date
 * @param days Number of non-Sunday days to add
 * @returns The new date after adding the specified number of non-Sunday days
 */
export const addNonSundayDays = (startDate: Date, days: number): Date => {
  const result = moment(startDate).tz("Africa/Lagos");
  let daysAdded = 0;

  while (daysAdded < days) {
    result.add(1, 'days');
    if (result.day() !== 0) { // 0 represents Sunday
      daysAdded++;
    }
  }

  return result.endOf('day').toDate();
};
