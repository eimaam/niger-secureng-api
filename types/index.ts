import { Document, Types } from "mongoose";

export interface IUser extends Document {
  fullName: string;
  phoneNumber: string;
  email: string;
  password: string;
  role: RoleName.SuperAdmin;
  isDefaultPassword: boolean;
  status: AccountStatusEnum;
  createdBy: Types.ObjectId;
}

export enum RoleName {
  SuperAdmin = "super_admin",
  Developer = "developer",
  Consultant = "consultant",
  GeneralAdmin = "general_admin",
  Admin = "admin",
  Government = "government",
  Stakeholder = "stakeholder",
  Service = "service",
  LgaHead = "lga_head",
  SuperVendor = "super_vendor",
  Vendor = "vendor",
  SuperVendorAdmin = "super_vendor_admin",
  VendorAdmin = "vendor_admin",
  WalletAdmin = "wallet_admin",
  Association = "association",
  ThirdParty = "third_party",
  UserAdmin = "user_admin",
  RoleAdmin = "role_admin",
  TransferAdmin = "transfer_admin",
  StateSuperAdmin = "state_super_admin",
  UserAccountAdmin = "user_account_admin",
  UnitAdmin = "unit_admin",
  AssociationAdmin = "association_admin",
  VehicleAdmin = "vehicle_admin",
  RegistrationAdmin = "registration_admin",
  DriverRegistrationAdmin = "driver_registration_admin",
  VehicleRegistrationAdmin = "vehicle_registration_admin",
  PrintingAdmin = "printing_admin",
  InvoiceAdmin = "invoice_admin",
  UpdateAdmin = "update_admin",
  VehicleUpdateAdmin = "vehicle_update_admin",
  DriverUpdateAdmin = "driver_update_admin",
}

export enum PaymentTypeEnum {
  TRICYCLE = 'TRICYCLE',
  OKADA = 'OKADA',
  JEGA = 'JEGA',
  OPEN_BODY = 'OPEN_BODY',
  SULEJA_TRICYCLE = 'SULEJA_TRICYCLE',
  SULEJA_OKADA = 'SULEJA_OKADA',
  SULEJA_JEGA = 'SULEJA_JEGA',
  TAFA_TRICYCLE = 'TAFA_TRICYCLE',
  TAFA_OKADA = 'TAFA_OKADA',
  TAXI = "TAXI",
  VEHICLE_LICENSE_RENEWAL = "VEHICLE_LICENSE_RENEWAL",
  VEHICLE_REGISTRATION = "VEHICLE_REGISTRATION",
  VEHICLE_UPDATE = "VEHICLE_UPDATE",
  VEHICLE_QR_CODE_PRINTING = "VEHICLE_QR_CODE_PRINTING",
  CERTIFICATE_PRINTING = "CERTIFICATE_PRINTING",
  DRIVER_REGISTRATION = "DRIVER_REGISTRATION",
  DRIVER_QR_CODE_PRINTING = 'DRIVER_QR_CODE_PRINTING',
  DRIVER_PERMIT_PRINTING = "DRIVER_PERMIT_PRINTING",
  DRIVER_PERMIT_RENEWAL = "DRIVER_PERMIT_RENEWAL",
}

export enum Religion {
  ISLAM = "islam",
  CHRISTIANITY = "christianity",
  OTHERS = "others",
}

export enum Gender {
  MALE = "male",
  FEMALE = "female",
  OTHERS = "others",
}

// vehicle
export enum VehicleStatusEnum {
  ACTIVATED = "ACTIVATED",
  NOT_ACTIVATED = "NOT_ACTIVATED",
  INACTIVE = "INACTIVE",
  SUSPENDED = "SUSPENDED",
  DELETED = "DELETED",
  BLACKLISTED = "BLACKLISTED",
}

export enum AccountStatusEnum {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  SUSPENDED = "SUSPENDED",
  DELETED = "DELETED",
}

// Define enum for vehicle type
export enum VehicleTypeEnum {
  TRICYCLE = 'TRICYCLE',
  OKADA = 'OKADA',
  JEGA = 'JEGA',
  OPEN_BODY = 'OPEN_BODY',
  SULEJA_TRICYCLE = 'SULEJA_TRICYCLE',
  SULEJA_OKADA = 'SULEJA_OKADA',
  SULEJA_JEGA = 'SULEJA_JEGA',
  TAFA_TRICYCLE = 'TAFA_TRICYCLE',
  TAFA_OKADA = 'TAFA_OKADA',
  TAXI = "TAXI",
}

export enum Complexion {
  FAIR = "fair",
  MEDIUM = "medium",
  DARK = "dark",
  OTHERS = "others",
}

export enum PaymentStatusEnum {
  SUCCESSFUL = "successful",
  PENDING = "pending",
  CANCELLED = "cancelled",
  REVERSED = "reversed",
  FAILED = "failed",
}

export enum AnalyticsFilterRange {
  DAILY = "daily",
  YESTERDAY = "yesterday",
  WEEKLY = "weekly",
  MONTHLY = "monthly",
  YEARLY = "yearly",
  CUSTOM = "custom",
  OVERALL = "overall",
}
