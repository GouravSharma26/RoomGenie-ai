export interface PasswordRequirementItem {
  id: 'minLength' | 'hasUppercase' | 'hasLowercase' | 'hasDigit' | 'hasSpecial' | 'noWhitespace';
  label: string;
  isMet: boolean;
}

export interface PasswordValidationResult {
  isValid: boolean;
  requirements: PasswordRequirementItem[];
  metCount: number;
  totalCount: number;
}

export interface PasswordConfirmationResult {
  isMatch: boolean;
  message: string;
}

export interface ParsedApiError {
  message: string;
  fieldErrors: Record<string, string[]>;
}

/**
 * Validates a password against client-side requirements:
 * 1. At least 8 characters
 * 2. At least one uppercase letter (A-Z)
 * 3. At least one lowercase letter (a-z)
 * 4. At least one digit (0-9)
 * 5. At least one special character
 * 6. No whitespace
 */
export function checkPasswordRequirements(password: string): PasswordValidationResult {
  const minLengthMet = password.length >= 8;
  const uppercaseMet = /[A-Z]/.test(password);
  const lowercaseMet = /[a-z]/.test(password);
  const digitMet = /[0-9]/.test(password);
  const specialMet = /[^A-Za-z0-9\s]/.test(password);
  const noWhitespaceMet = password.length > 0 && !/\s/.test(password);

  const requirements: PasswordRequirementItem[] = [
    {
      id: 'minLength',
      label: 'At least 8 characters',
      isMet: minLengthMet,
    },
    {
      id: 'hasUppercase',
      label: 'At least one uppercase letter (A-Z)',
      isMet: uppercaseMet,
    },
    {
      id: 'hasLowercase',
      label: 'At least one lowercase letter (a-z)',
      isMet: lowercaseMet,
    },
    {
      id: 'hasDigit',
      label: 'At least one digit (0-9)',
      isMet: digitMet,
    },
    {
      id: 'hasSpecial',
      label: 'At least one special character (!@#$%^&* etc.)',
      isMet: specialMet,
    },
    {
      id: 'noWhitespace',
      label: 'No whitespace',
      isMet: noWhitespaceMet,
    },
  ];

  const metCount = requirements.filter((r) => r.isMet).length;
  const totalCount = requirements.length;
  const isValid = metCount === totalCount;

  return {
    isValid,
    requirements,
    metCount,
    totalCount,
  };
}

/**
 * Checks whether the confirm password matches the primary password.
 */
export function checkPasswordConfirmation(
  password: string,
  passwordConfirm: string
): PasswordConfirmationResult {
  if (!passwordConfirm) {
    return {
      isMatch: false,
      message: 'Password confirmation is required',
    };
  }

  if (password.length > 0 && password === passwordConfirm) {
    return {
      isMatch: true,
      message: 'Passwords match',
    };
  }

  return {
    isMatch: false,
    message: 'Passwords do not match',
  };
}

/**
 * Parses Django REST Framework validation responses and extracts actionable error messages.
 * Handles:
 * - Specific password errors like "This password is too common."
 * - Username uniqueness errors like "A user with that username already exists."
 * - Email format errors like "Enter a valid email address."
 * - Field error arrays: { errors: { field: [msg1, msg2] } }
 * - Direct serializer error maps: { field: [msg] }
 * - Detail strings: { detail: "..." }
 * - Fallbacks when no usable details are found.
 * Never exposes credentials or passwords in messages.
 */
export function parseAuthApiError(
  data: any,
  fallbackMessage = 'Registration validation failed.'
): ParsedApiError {
  if (!data || typeof data !== 'object') {
    return {
      message: fallbackMessage,
      fieldErrors: {},
    };
  }

  const fieldErrors: Record<string, string[]> = {};
  const rawErrors = data.errors && typeof data.errors === 'object' ? data.errors : data;

  for (const [key, val] of Object.entries(rawErrors)) {
    if (key === 'detail' && rawErrors === data) {
      // Top-level detail is handled separately if no field-specific errors exist
      continue;
    }
    if (key === 'errors' && rawErrors === data) {
      continue;
    }

    if (Array.isArray(val)) {
      const msgs = val.map(String).map((s) => s.trim()).filter(Boolean);
      if (msgs.length > 0) {
        fieldErrors[key] = msgs;
      }
    } else if (typeof val === 'string' && val.trim()) {
      fieldErrors[key] = [val.trim()];
    }
  }

  const fields = Object.keys(fieldErrors);

  if (fields.length > 0) {
    if (fields.length === 1) {
      const singleField = fields[0];
      const msgs = fieldErrors[singleField];
      return {
        message: msgs.join(' '),
        fieldErrors,
      };
    }

    // Multiple fields: order by logical registration sequence
    const preferredOrder = ['username', 'email', 'password', 'non_field_errors'];
    const orderedFields = [
      ...preferredOrder.filter((f) => fields.includes(f)),
      ...fields.filter((f) => !preferredOrder.includes(f)),
    ];

    const messageParts = orderedFields.map((f) => {
      const fieldName = f === 'non_field_errors' ? 'Error' : f.charAt(0).toUpperCase() + f.slice(1);
      return `${fieldName}: ${fieldErrors[f].join(' ')}`;
    });

    return {
      message: messageParts.join(' '),
      fieldErrors,
    };
  }

  // If no field errors, look for detail
  if (typeof data.detail === 'string' && data.detail.trim()) {
    return {
      message: data.detail.trim(),
      fieldErrors: {},
    };
  }

  return {
    message: fallbackMessage,
    fieldErrors: {},
  };
}
