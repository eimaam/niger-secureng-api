import mongoose, { Document, Schema } from 'mongoose';

export interface ILgaHead extends Document {
  fullName: string;
  phoneNumber: string;
  lga: mongoose.Types.ObjectId; 
  // wallet: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
}

export const LgaHeadSchema: Schema = new Schema<ILgaHead>({
  fullName: {
    type: String,
    required: true,
  }, 
  phoneNumber: {
    type: String,
    required: true,
    maxlength: 11,
    minlength: 11,
    unique: true
  },
  lga: {
    type: Schema.Types.ObjectId,
    ref: 'LGA',
    required: true
  },
  // wallet: {
  //   type: Schema.Types.ObjectId,
  //   ref: 'Wallet',
  //   required: true
  // },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true} );

const LgaHead = mongoose.model<ILgaHead>('LgaHead', LgaHeadSchema);

export default LgaHead;