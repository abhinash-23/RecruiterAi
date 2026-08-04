import type { FieldSpec } from "@/components/shared/field-schema"

// Form definitions for every entity the app creates or edits. Each mirrors the
// request body of the endpoint behind it, so a field that isn't here is a field
// the API won't accept.

/**
 * Create form for a tenant + its admin login, used by Super Admin.
 *
 * Mirrors the body of `POST /api/platform/admins` exactly. `slug` is omitted on
 * purpose — the server derives it from the company name.
 */
export const ADMIN_CREATE_FIELDS: FieldSpec[] = [
  {
    name: "name",
    label: "Company Name",
    kind: "text",
    placeholder: "Northwind Labs",
    description: "Names the tenant. The URL slug is generated from it.",
    required: true,
    // The server rejects anything shorter with a 422; catching it here means
    // the reader is told as they type instead of after a round-trip.
    minLength: 2,
  },
  {
    name: "adminEmail",
    label: "Admin Email",
    kind: "email",
    placeholder: "jordan@northwind.com",
    description: "Becomes their login. Cannot be changed afterwards.",
    required: true,
  },
  {
    name: "adminFullName",
    label: "Admin Name",
    kind: "text",
    placeholder: "Jordan Avery",
  },
  {
    name: "adminPhone",
    label: "Admin Phone",
    kind: "phone",
  },
  {
    name: "supportEmail",
    label: "Support Email",
    kind: "email",
    placeholder: "support@northwind.com",
    description: "Shown to this tenant's candidates. Optional.",
    full: true,
  },
]

/**
 * Edit form for an existing tenant.
 *
 * Deliberately shorter than the create form: `PATCH /api/platform/admins/:id`
 * accepts only these two fields. The admin's email, name and phone are fixed
 * once the login exists.
 */
export const ADMIN_EDIT_FIELDS: FieldSpec[] = [
  {
    name: "name",
    label: "Company Name",
    kind: "text",
    placeholder: "Northwind Labs",
    required: true,
    // `PATCH` enforces the same 2-character minimum as create.
    minLength: 2,
    full: true,
  },
  {
    name: "supportEmail",
    label: "Support Email",
    kind: "email",
    placeholder: "support@northwind.com",
    full: true,
  },
]

/** Create/edit form for an HR seat, used by Admin. */
export const HR_CREATE_FIELDS: FieldSpec[] = [
  {
    name: "email",
    label: "Email",
    kind: "email",
    placeholder: "mei@northwind.com",
    description: "Becomes their login. Cannot be changed afterwards.",
    required: true,
    full: true,
  },
  {
    name: "fullName",
    label: "Name",
    kind: "text",
    placeholder: "Mei Kim",
  },
  {
    name: "phone",
    label: "Phone",
    kind: "phone",
  },
]

/**
 * Edit form for a recruiter seat. Shorter than the create form because
 * `PATCH /api/company/hrs/:id` accepts only these two — it ignores `email`
 * outright, so offering it would look like it saved when it hadn't.
 */
export const HR_EDIT_FIELDS: FieldSpec[] = [
  {
    name: "fullName",
    label: "Name",
    kind: "text",
    placeholder: "Mei Kim",
    required: true,
  },
  {
    name: "phone",
    label: "Phone",
    kind: "phone",
  },
]

/**
 * Create/edit form for a job — the root of the recruiting funnel.
 *
 * The description is not decoration: it is what every candidate's résumé is
 * scored against, which is why the server enforces a 30-character floor.
 */
export const JOB_FIELDS: FieldSpec[] = [
  {
    name: "title",
    label: "Job Title",
    kind: "text",
    placeholder: "Senior Backend Engineer",
    required: true,
    minLength: 2,
    maxLength: 255,
    full: true,
  },
  {
    name: "role",
    label: "Interview Role",
    kind: "text",
    placeholder: "Leave blank to reuse the title",
    description: "What the candidate is told they're interviewing for.",
    full: true,
  },
  {
    name: "jobDescription",
    label: "Job Description",
    kind: "textarea",
    placeholder:
      "Responsibilities, must-have skills, tools, seniority… the more concrete, the better the résumé scoring.",
    description: "Candidates are scored against this text.",
    required: true,
    minLength: 30,
    maxLength: 20000,
    full: true,
  },
]
