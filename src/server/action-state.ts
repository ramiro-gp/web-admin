export type ActionState = { success?: string; error?: string; fieldErrors?: Record<string, string[]> };
export type FormAction = (previous: ActionState, data: FormData) => Promise<ActionState>;
