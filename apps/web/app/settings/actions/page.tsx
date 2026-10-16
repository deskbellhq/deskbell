import { redirect } from "next/navigation";

/** Actions moved out of Settings into the main navigation; old links still land. */
export default function SettingsActionsRedirect() {
  redirect("/actions");
}
