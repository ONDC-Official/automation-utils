// ─── OpenAPI shared primitives ──────────────────────────────────────────────

export interface SchemaObject {
  type?: string;
  description?: string;
  enum?: unknown[];
  properties?: Record<string, SchemaObject>;
  additionalProperties?: boolean | SchemaObject;
  required?: string[];
  items?: SchemaObject;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  $ref?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  minItems?: number;
  [key: string]: unknown;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

export interface RequestBody {
  description?: string;
  content: {
    "application/json": {
      schema: SchemaObject;
    };
  };
  required?: boolean;
}

export interface ResponseObject {
  description?: string;
  content?: {
    "application/json": {
      schema: SchemaObject;
    };
  };
  $ref?: string;
}

export type Responses = Record<string, ResponseObject>;

export interface Operation {
  tags?: string[];
  description?: string;
  requestBody?: RequestBody;
  responses: Responses;
}

export interface PathItem {
  post?: Operation;
  get?: Operation;
  put?: Operation;
  delete?: Operation;
}

// ─── Info / Security ────────────────────────────────────────────────────────

export interface InfoObject {
  title: string;
  description?: string;
  version: string;
  domain?: string;
}

export interface SecurityScheme {
  type: string;
  in?: string;
  name?: string;
  description?: string;
}

export interface Components {
  securitySchemes?: Record<string, SecurityScheme>;
  schemas?: Record<string, SchemaObject>;
}

// ─── Top-level document ─────────────────────────────────────────────────────

export interface OpenAPIDocument {
  openapi: string;
  info: InfoObject;
  security?: Array<Record<string, string[]>>;
  paths: Record<string, PathItem>;
  components?: Components;
}
