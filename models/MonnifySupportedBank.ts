import mongoose, { Schema, Document } from 'mongoose';


interface MonnifySupportedBank extends Document {
    name: string;
    code: string;
    ussdTemplate: string | null;
    baseUssdCode: string | null;
    transferUssdTemplate: string | null;
    bankId: string | null;
    nipBankCode: string;
}

const MonnifySupportedBankSchema: Schema = new Schema({
    name: { type: String, required: true, },
    code: { type: String, required: true },
    ussdTemplate: { type: String, default: null },
    baseUssdCode: { type: String, default: null },
    transferUssdTemplate: { type: String, default: null },
    bankId: { type: String, default: null },
    nipBankCode: { type: String }
});

const MonnifySupportedBankModel = mongoose.models.MonnifySupportedBank || mongoose.model<MonnifySupportedBank>('MonnifySupportedBank', MonnifySupportedBankSchema);

export default MonnifySupportedBankModel;