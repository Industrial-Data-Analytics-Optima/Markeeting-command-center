import { useEffect } from "react";
export function allowWorkspaceNavigation() {
  return window.dispatchEvent(
    new Event("hub:before-navigate", { cancelable: true }),
  );
}
export function useUnsavedChanges(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: Event) => {
      const checked = event as Event & { hubChecked?: boolean };
      if (event.defaultPrevented || checked.hubChecked) return;
      checked.hubChecked = true;
      if (
        !confirm(
          "Leave this section? Unsaved changes or active uploads will be lost.",
        )
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("hub:before-navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("hub:before-navigate", navigate);
    };
  }, [unsaved]);
}
