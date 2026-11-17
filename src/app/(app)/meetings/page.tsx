import { redirect } from "next/navigation";

// Meetings were removed from the sales process (the old records stay in the database). The follow-up date on the pipeline replaces them.
export default function MeetingsPage() { redirect("/pipeline"); }
