import { Request, Response, Router } from "express";
import { Auth } from "../handlers/auth";
import { Vehicles } from "../handlers/vehicle";

const route = Router();

route.get("/healthcheck", async (_req, res) => {
  res.status(200).json({
    success: true,
    message: "API is running...",
  });
});

route.get("/vehicle/public/verify/:identityCode", Vehicles.getDataByIdentityCode);

const unauthenticatedRoutes = route;

export default unauthenticatedRoutes;
