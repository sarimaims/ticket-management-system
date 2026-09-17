import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Department name is required'],
      trim: true,
      maxlength: 80,
      unique: true,
    },
    // Short handle shown next to the name, e.g. "HR", "ITS".
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

/** "Human Resources" -> "HUM"; collisions get a numeric suffix by the caller. */
departmentSchema.statics.codeFrom = function codeFrom(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const raw =
    words.length > 1
      ? words.map((word) => word[0]).join('')
      : words[0]?.slice(0, 3) ?? 'DEP';
  return raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) || 'DEP';
};

const Department = mongoose.model('Department', departmentSchema);

export default Department;
