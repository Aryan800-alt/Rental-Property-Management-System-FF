import { z } from 'zod';

export const signupSchema = z.object({
  name:     z.string().min(2, 'Name must be at least 2 characters').max(120).trim(),
  email:    z.string().email('Invalid email address').max(255).toLowerCase(),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
  // Note: 'admin' is intentionally excluded — admins must be provisioned directly in the DB.
  role:     z.enum(['tenant', 'owner'], { errorMap: () => ({ message: 'Role must be tenant or owner.' }) }),
});

export const loginSchema = z.object({
  email:    z.string().email('Invalid email address').max(255),
  password: z.string().min(1, 'Password is required').max(128),
});

export const addFlatSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(150),
  description: z.string().max(1000).optional(),
  city: z.string().min(2, 'City is required').max(100),
  address: z.string().max(255).optional(),
  type: z.enum(['1BHK', '2BHK', '3BHK', '4BHK+', 'Studio']),
  rent: z.coerce.number().min(0, 'Rent must be a positive number'),
  deposit: z.coerce.number().min(0).optional().default(0),
  furnished: z.coerce.number().int().min(0).max(1),
  images: z.array(z.string().url('Must be a valid Cloudinary URL')).max(10).optional().default([]),
  image_public_ids: z.array(z.string()).max(10).optional().default([]),
  amenities: z.array(z.string()).max(20).optional().default([]),
  preferred_contact: z.string().max(50).optional(),
  best_time_to_call: z.string().max(100).optional(),
  owner_note: z.string().max(500).optional(),
  contact_phone: z.string().max(20).optional(),
  contact_email: z.string().email().max(100).optional().or(z.literal('')),
  contact_whatsapp: z.string().max(20).optional(),
  contact_telegram: z.string().max(50).optional(),
}).passthrough();

export const bookingSchema = z.object({
  flat_id:   z.coerce.number().int().positive(),
  check_in:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
}).refine(
  (data) => new Date(data.check_out) > new Date(data.check_in),
  { message: 'check_out must be after check_in', path: ['check_out'] }
);

// Middleware to validate request body
export const validateBody = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err) {
    if (err instanceof z.ZodError) {
      const messages = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      return res.status(400).json({ success: false, data: null, message: `Validation Error: ${messages}` });
    }
    next(err);
  }
};
