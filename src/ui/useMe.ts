"use client";

import { useContext } from "react";
import { MeContext, type MeState } from "./MeProvider";

/** The signed-in account and what its plan allows, shared by MeProvider in the (app) layout. */
export function useMe(): MeState {
  const state = useContext(MeContext);
  if (!state) throw new Error("useMe must be used inside MeProvider");
  return state;
}
