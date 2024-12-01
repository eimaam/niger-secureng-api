import mongoose, { Schema, Document } from 'mongoose';
import { PaymentStatusEnum } from '../types';

interface IBeneficiaryDetail {
  userId: mongoose.Types.ObjectId; // Reference to User
  percentage: number; // Percentage of the total amount for the beneficiary in the tx
}

interface ITransaction extends Document {
  vehicle?: mongoose.Types.ObjectId; // Reference to Vehicle for transactions that are vehicle related
  driver?: mongoose.Types.ObjectId; // Reference to Driver for transactions that are driver related
  amount: number; // Amount paid
  type: mongoose.Types.ObjectId; // Reference to PaymentType
  daysPaid?: number; // Number of days paid for
  paidTill?: Date; // Date till which payment was made marking expiry date of that tax payment
  date: Date; // Date of transaction
  status: PaymentStatusEnum; // Status of the transaction 
  beneficiaries: IBeneficiaryDetail[]; // Array of beneficiaries with their percentages
  processedBy: mongoose.Types.ObjectId; // Reference to User
}

const TransactionSchema = new Schema<ITransaction>({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', index: true },
  driver: { type: Schema.Types.ObjectId, ref: 'Driver', index: true },
  amount: { type: Number, required: true, index: true },
  type: { type: Schema.Types.ObjectId, ref: 'PaymentType', required: true, index: true },
  daysPaid: { type: Number },
  paidTill: { type: Date },
  date: { type: Date, required: true, default: Date.now, index: true },
  status: { type: String, enum: Object.values(PaymentStatusEnum), default: PaymentStatusEnum.SUCCESSFUL , index:true },
  beneficiaries: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    percentage: { type: Number, required: true },
  }],
  processedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
}, { timestamps: true });

// Add a custom validator to ensure either vehicle or driver is set
TransactionSchema.pre('save', function(next) {
  if (!this.vehicle && !this.driver) {
    next(new Error('Either vehicle or driver must be set'));
  } else if (this.vehicle && this.driver) {
    next(new Error('Only one of vehicle or driver can be set'));
  } else {
    next();
  }
});

const TransactionModel = mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);

interface IDownloadHistory extends Document {
  vehicle?: mongoose.Types.ObjectId; // Reference to Vehicle
  driver?: mongoose.Types.ObjectId; // Reference to Driver
  type: mongoose.Types.ObjectId; // Reference to PaymentType
  date: Date; // Date of download
  processedBy: mongoose.Types.ObjectId; // Reference to User
}



const DownloadHistorySchema = new Schema<IDownloadHistory>({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', index: true },
  driver: { type: Schema.Types.ObjectId, ref: 'Driver', index: true },
  type: { type: Schema.Types.ObjectId, ref: 'PaymentType', required: true, index: true },
  date: { type: Date, required: true, default: Date.now, index: true },
  processedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
}, { timestamps: true });

const DownloadHistoryModel = mongoose.models.DownloadHistory || mongoose.model<IDownloadHistory>('DownloadHistory', DownloadHistorySchema);

export { ITransaction, TransactionModel, IDownloadHistory, DownloadHistoryModel };
