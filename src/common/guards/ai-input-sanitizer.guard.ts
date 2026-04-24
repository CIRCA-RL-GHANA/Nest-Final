/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AiInputSanitizerGuard
 *
 * Recommendation 5 — Input Sanitization at the Edge (backend mirror).
 *
 * Applied to all AI controller endpoints. Validates and normalises the
 * `input`, `query`, `text`, and `message` fields in the request body,
 * rejecting or cleaning inputs that:
 *   • Exceed the maximum token length
 *   • Contain prompt injection patterns ("ignore previous instructions" etc.)
 *   • Carry code injection payloads (SQL, JS, shell)
 *   • Are adversarially constructed to confuse the intent parser
 *
 * If rejected, returns 400 Bad Request with a structured error. If cleaned,
 * the guard mutates req.body in place so downstream handlers see safe input.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';

const MAX_INPUT_LENGTH = 1024;

/**
 * Patterns that indicate prompt injection or code injection attempts.
 * Tested against the concatenated string of all text fields in the body.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Prompt injection
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /forget\s+(your\s+)?system\s+prompt/i,
  /you\s+are\s+now\s+a\s+different\s+(ai|assistant|bot)/i,
  /act\s+as\s+if\s+you\s+have\s+no\s+restrictions/i,
  // SQL injection
  /(--|;|\/\*|\*\/|xp_|exec\s+|union\s+select|drop\s+table)/i,
  // Script/HTML injection
  /<script[\s\S]*?>[\s\S]*?<\/script>/i,
  /javascript\s*:/i,
  /on\w+\s*=/i,
  // Shell meta-chars in sequence
  /[`$]{1}.*[{}()]/,
];

/** Full-width Unicode to ASCII normalisation range */
const FULLWIDTH_OFFSET = 0xfee0;

function normaliseText(input: string): string {
  // 1. Normalise full-width ASCII to standard ASCII
  let out = input.replace(
    /[\uFF01-\uFF5E]/g,
    (c) => String.fromCharCode(c.charCodeAt(0) - FULLWIDTH_OFFSET),
  );
  // 2. Strip control characters
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // 3. Collapse repeated whitespace
  out = out.replace(/\s{3,}/g, '  ').trim();
  return out;
}

function containsInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

@Injectable()
export class AiInputSanitizerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') return true;

    // Fields that carry natural-language input to the AI layer
    const textFields = ['input', 'query', 'text', 'message', 'prompt', 'command'];

    const sanitisedBody: Record<string, unknown> = { ...body };
    let combinedText = '';

    for (const field of textFields) {
      const value = body[field];
      if (typeof value !== 'string') continue;

      // Length check
      if (value.length > MAX_INPUT_LENGTH) {
        throw new BadRequestException(
          `Input field "${field}" exceeds the maximum allowed length of ${MAX_INPUT_LENGTH} characters.`,
        );
      }

      const normalised = normaliseText(value);
      combinedText += ' ' + normalised;
      sanitisedBody[field] = normalised;
    }

    // Injection detection on the combined text
    if (containsInjection(combinedText)) {
      throw new BadRequestException(
        'Input contains disallowed patterns and was rejected.',
      );
    }

    // Mutate body in place with cleaned values
    Object.assign(req.body, sanitisedBody);
    return true;
  }
}
