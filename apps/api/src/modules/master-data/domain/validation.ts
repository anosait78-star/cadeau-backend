import type { FieldSpec, ResourceDescriptor } from "./resource.types";

/** A single field validation error, matching api-conventions §4 `details`. */
export interface FieldError {
  readonly field: string;
  readonly messages: string[];
}

/** The outcome of validating a write body. */
export interface ValidationResult {
  /** The cleaned, type-correct data (only when `errors` is empty). */
  readonly data: Record<string, unknown>;
  readonly errors: FieldError[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate and coerce a single field value against its spec. Returns the cleaned
 * value (possibly `null`) or a list of messages. A string is trimmed; `null` is
 * only accepted for nullable fields.
 */
function validateValue(spec: FieldSpec, value: unknown): { value?: unknown; messages?: string[] } {
  if (value === null) {
    if (spec.nullable === true) return { value: null };
    return { messages: [`${spec.name} must not be null`] };
  }

  switch (spec.kind) {
    case "string":
    case "enum":
    case "uuid":
    case "color": {
      if (typeof value !== "string") return { messages: [`${spec.name} must be a string`] };
      const trimmed = value.trim();
      const messages: string[] = [];
      if (trimmed.length === 0) messages.push(`${spec.name} must not be empty`);
      if (spec.minLength !== undefined && trimmed.length < spec.minLength) {
        messages.push(`${spec.name} must be at least ${spec.minLength} characters`);
      }
      if (spec.maxLength !== undefined && trimmed.length > spec.maxLength) {
        messages.push(`${spec.name} must be at most ${spec.maxLength} characters`);
      }
      if (
        spec.kind === "enum" &&
        spec.enumValues !== undefined &&
        !spec.enumValues.includes(trimmed)
      ) {
        messages.push(`${spec.name} must be one of: ${spec.enumValues.join(", ")}`);
      }
      if (spec.kind === "uuid" && !UUID_RE.test(trimmed)) {
        messages.push(`${spec.name} must be a valid uuid`);
      }
      if (spec.kind === "color" && !HEX_COLOR_RE.test(trimmed)) {
        messages.push(`${spec.name} must be a hex color (e.g. #E11931)`);
      }
      return messages.length > 0 ? { messages } : { value: trimmed };
    }
    case "int": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return { messages: [`${spec.name} must be an integer`] };
      }
      const messages: string[] = [];
      if (spec.min !== undefined && value < spec.min) {
        messages.push(`${spec.name} must be at least ${spec.min}`);
      }
      if (spec.max !== undefined && value > spec.max) {
        messages.push(`${spec.name} must be at most ${spec.max}`);
      }
      return messages.length > 0 ? { messages } : { value };
    }
    case "boolean": {
      if (typeof value !== "boolean") return { messages: [`${spec.name} must be a boolean`] };
      return { value };
    }
    default:
      return { messages: [`${spec.name} is not supported`] };
  }
}

/** The field specs that may appear in a create body (id when client-provided + fields). */
function createSpecs(descriptor: ResourceDescriptor): FieldSpec[] {
  const specs: FieldSpec[] = [...descriptor.fields];
  if (descriptor.clientProvidesId && descriptor.idSpec !== undefined) {
    specs.unshift(descriptor.idSpec);
  }
  return specs;
}

/**
 * Validate a create body: reject unknown keys, enforce required/typed fields,
 * and coerce. `active` is not client-settable on create (rows are born active).
 */
export function validateCreate(descriptor: ResourceDescriptor, body: unknown): ValidationResult {
  const errors: FieldError[] = [];
  const data: Record<string, unknown> = {};
  if (!isPlainObject(body)) {
    return { data, errors: [{ field: "body", messages: ["body must be an object"] }] };
  }

  const specs = createSpecs(descriptor);
  const allowed = new Set(specs.map((s) => s.name));
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      errors.push({ field: key, messages: [`unexpected property ${key}`] });
    }
  }

  for (const spec of specs) {
    const present = Object.prototype.hasOwnProperty.call(body, spec.name);
    if (!present) {
      if (spec.required === true) {
        errors.push({ field: spec.name, messages: [`${spec.name} is required`] });
      }
      continue;
    }
    const result = validateValue(spec, body[spec.name]);
    if (result.messages !== undefined) {
      errors.push({ field: spec.name, messages: result.messages });
    } else {
      data[spec.name] = result.value;
    }
  }

  return { data, errors };
}

/**
 * Validate an update (PATCH) body: only updatable fields plus `active`, at least
 * one, unknown keys rejected. Absent fields are left untouched.
 */
export function validateUpdate(descriptor: ResourceDescriptor, body: unknown): ValidationResult {
  const errors: FieldError[] = [];
  const data: Record<string, unknown> = {};
  if (!isPlainObject(body)) {
    return { data, errors: [{ field: "body", messages: ["body must be an object"] }] };
  }

  const updatable = descriptor.fields.filter((s) => s.updatable !== false);
  const byName = new Map(updatable.map((s) => [s.name, s]));
  const allowed = new Set<string>([...byName.keys(), "active"]);

  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      errors.push({ field: key, messages: [`unexpected property ${key}`] });
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "active")) {
    if (typeof body["active"] !== "boolean") {
      errors.push({ field: "active", messages: ["active must be a boolean"] });
    } else {
      data["isActive"] = body["active"];
    }
  }

  for (const spec of updatable) {
    if (!Object.prototype.hasOwnProperty.call(body, spec.name)) continue;
    const result = validateValue(spec, body[spec.name]);
    if (result.messages !== undefined) {
      errors.push({ field: spec.name, messages: result.messages });
    } else {
      data[spec.name] = result.value;
    }
  }

  if (errors.length === 0 && Object.keys(data).length === 0) {
    errors.push({ field: "body", messages: ["provide at least one field to update"] });
  }

  return { data, errors };
}
