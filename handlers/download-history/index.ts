import { Request, Response } from "express";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { query, validationResult } from "express-validator";
import { AnalyticsFilterRange, PaymentTypeEnum } from "../../types";
import { getDateRange } from "../../utils";
import { Vehicle } from "../../models/Vehicle";
import { DownloadHistoryModel } from "../../models/Transaction";
import { UserModel } from "../../models/User";

export class DownloadHistory {
    static async getAll(req: Request, res: Response){
        const { type, filter, year, vehicleCode, driverId, 
            processedBy // name of the user that processed the download
        } = req.query;

        const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
        const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
        const skip = Number(page - 1) * limit;

        // verify queries via express-validator
        const validations  = [
            query("type").optional().isMongoId(),
            query("filter").optional().isIn(Object.values(AnalyticsFilterRange)),
            query("year").optional().isInt(),
            query("vehicleCode").optional().isString(),
            query("driverId").optional().isMongoId(),
            query("page").optional().isInt(),
            query("limit").optional().isInt(),
        ];

        await Promise.all(validations.map(validation => validation.run(req)));

        const errors = validationResult(req);

        if(!errors.isEmpty()){
            return res.status(400).json(
                { 
                    success: false,
                    message: errors.array()?.[0]?.msg,
                    errors: errors.array()
                }
            );
        }

        // set date range
        let dateRange: { startDate: Date, endDate: Date } | undefined; 
        if (filter && year){
            dateRange = getDateRange(filter as AnalyticsFilterRange, year as unknown as number);
        }

        try {

            const query: any = {};

            if (type){
                query.type = type;
            }

            if (dateRange){
                query.date = dateRange;
            }

            if (vehicleCode){
                const code = (vehicleCode as string).toUpperCase();
                const vehicle = await Vehicle.findOne({ identityCode: code });
                if (!vehicle){
                    return res.status(404).json({
                        success: false,
                        message: "Vehicle not found"
                    });
                }

                query.vehicle = vehicle._id;
            }

            if (driverId){
                query.driver = driverId;
            }

            if (processedBy){
            //  make the name regex case insensitive then get the user from the database

            const user = await UserModel.findOne({ fullName: { $regex: new RegExp(processedBy as string, "i") } });

            if (!user){
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

// apply the user id to the query
                query.processedBy = user._id;

            }

            

            const downloadHistory = await DownloadHistoryModel.find(query)
                .populate({
                    path: "vehicle",
                    select: "identityCode licensePlateNumber",
                })
                .populate({
                    path: "driver",
                    select: "fullName",
                })
                .populate({
                    path: "type",
                    select: "name",
                })
                .populate({
                    path: "processedBy",
                    select: "fullName",
                })
                .skip(skip)
                .limit(limit)
                .sort({ date: -1 });

                const total = await DownloadHistoryModel.countDocuments(query);

                const data = {
                    total,
                    page,
                    totalPages: Math.ceil(total / limit),
                   data: downloadHistory
                };
                

            return res.status(200).json({
                success: true,
                message: "Download history fetched successfully",
                data
            });

            
        } catch (error:any) {
            console.log(error);
            return res.status(500).json({
                success: false,
                message: "An error occurred while fetching download history",
                error: error.message
            });
        }



    }
}