/**
 * The parts of an Alpaco design the CLI looks into. Everything else in a
 * design is carried through untouched, so these types stay open.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface Input extends JsonObject {}

export interface InputGroup {
  key?: string;
  name?: string;
  repeatable?: boolean;
  inputs?: Input[];
  [key: string]: unknown;
}

/** The base or a block: Liquid `code` plus the input groups marketers fill in. */
export interface Unit {
  key?: string;
  name?: string;
  code?: string;
  inputGroups?: InputGroup[];
  [key: string]: unknown;
}

export interface Design {
  base?: Unit;
  blocks?: Unit[];
  vars?: { global?: string; [key: string]: Json | undefined };
  [key: string]: unknown;
}
