import mongoose, { Document, Schema } from "mongoose";

export interface IIssuable extends Document {
  name: string;
  description: string;
}

const IssuablesSchema: Schema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  description: {
    type: String,
    minlength: 5,
    trim: true,
  },
});

export const Issuable = mongoose.model<IIssuable>("Issuable", IssuablesSchema);
