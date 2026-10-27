export type FormState = {
  error?: string;
  ok?: string;
  toast?: { title: string; text: string; level: "info" | "good" | "great"; count: number; goal: number | null; next: number; achievements: string[] };
  values?: Record<string, string>;
  dup?: { owner_name: string | null; existing_client_id: string; matched_kinds: string[]; ambiguous: boolean; attempted: Record<string, string> };
};
export const initial: FormState = {};
