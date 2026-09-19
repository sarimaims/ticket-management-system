import mongoose from 'mongoose';

/**
 * The level above a department: a business unit, a branch, a company inside
 * the group. Every department belongs to exactly one, so the org chart reads
 * Unit -> Department -> head and team.
 */
const unitSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Unit name is required'],
      trim: true,
      maxlength: 80,
      unique: true,
    },
    // Short handle shown next to the name, e.g. "AIMS", "CORP".
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 8,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 280,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true },
);

/** "Aims Healthcare" -> "AH"; collisions get a numeric suffix by the caller. */
unitSchema.statics.codeFrom = function codeFrom(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const raw =
    words.length > 1 ? words.map((word) => word[0]).join('') : (words[0]?.slice(0, 4) ?? 'UNIT');
  return raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) || 'UNIT';
};

const Unit = mongoose.model('Unit', unitSchema);

export default Unit;
