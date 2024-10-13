import dotenv from "dotenv";
dotenv.config();

import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import route from "../routes/route";
import { connectMongoDB } from "../utils/connectMongo";
import cors from "cors";
import { verifyToken } from "../middlewares/auth.middleware";
import { API_RATE_LIMIT, WEBHOOK_RATE_LIMIT } from "../utils/constants";
import { Config } from "../utils/config";
import { checkPasswordChanged } from "../middlewares/defaultPasswordCheck.middleware";

const PORT = process.env.PORT || 4000;

const app = express();

// trust proxy headers
app.set('trust proxy', 1);

app.use(express.json());

// enable cors globally
app.use(cors());

// Apply general rate limiting to all routes
const apiLimiter = rateLimit({
  windowMs: API_RATE_LIMIT.WINDOW_MS,
  limit: API_RATE_LIMIT.MAX_REQUESTS,
  message: API_RATE_LIMIT.MESSAGE,
  standardHeaders: API_RATE_LIMIT.STANDARD_HEADERS,
  legacyHeaders: API_RATE_LIMIT.LEGACY_HEADERS,
});
app.use(apiLimiter);

// Apply stricter rate limiting to webhook routes
const webhookLimiter = rateLimit({
  windowMs: WEBHOOK_RATE_LIMIT.WINDOW_MS,
  limit: WEBHOOK_RATE_LIMIT.MAX_REQUESTS,
  message: WEBHOOK_RATE_LIMIT.MESSAGE,
  standardHeaders: WEBHOOK_RATE_LIMIT.STANDARD_HEADERS,
  legacyHeaders: WEBHOOK_RATE_LIMIT.LEGACY_HEADERS,
  skip: (req) => {
    const incomingIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    return incomingIP === whitelistIP;
  }
});
app.use('/api/v1/webhook', webhookLimiter);

// Middleware to handle IP whitelisting for specific routes
const whitelistIP = Config.MONNIFY_WEBHOOK_IP;

const handleWebhookCors = (req:Request, res:Response, next:NextFunction) => {
  if (req.originalUrl.startsWith('/api/v1/webhook')) {
    const incomingIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    
    // If the incoming IP matches the whitelisted IP, disable CORS
    if (incomingIP === whitelistIP) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
  }
  next();
};

// Apply the IP whitelisting middleware
app.use(handleWebhookCors);

// verify authorization token middleware
app.use(verifyToken);

app.use(checkPasswordChanged);

app.use("/api/v1", route);

async function startServer() {
  try {
    await connectMongoDB();
    app.listen(PORT, () => console.log(`API is running on PORT ${PORT}`));
  } catch (error) {
    console.error("Error connecting to MongoDB: ", error);
  }
}

startServer();
