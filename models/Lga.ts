import mongoose, { Document, Schema } from 'mongoose';

export interface ILGA extends Document {
  name: string,
}

const LGASchema: Schema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true
  }, 
});

export const LGA = mongoose.model<ILGA>('LGA', LGASchema);
