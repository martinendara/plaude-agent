import { defineHook } from "workflow";

export const chatMessageHook = defineHook<{ message: string }>();
