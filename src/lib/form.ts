export type FormState = {
  error?: string;
  ok?: string;
  values?: Record<string, string>;
  dup?: { owner_name: string | null; existing_client_id: string; matched_kinds: string[]; ambiguous: boolean; attempted: Record<string, string> };
};
export const initial: FormState = {};
