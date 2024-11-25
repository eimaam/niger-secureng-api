import rateLimit from "express-rate-limit";

// Rate limiter configuration
export const forgotPasswordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // Limit each email to 3 requests per hour
    message: "Too many password reset requests. Please try again later.",
    keyGenerator: (req) => req.body.email, // Use email as the key
  });