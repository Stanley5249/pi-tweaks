export type Choice = Readonly<{
  get: () => boolean | undefined;
  set: (value: boolean) => void;
}>;

// The `/guard` choice outlives the extension runtime.
const choiceKey = Symbol.for("pi-tweaks.guard.enabled");

export const processChoice: Choice = {
  get: () => {
    const value: unknown = Reflect.get(globalThis, choiceKey);
    return typeof value === "boolean" ? value : undefined;
  },
  set: (value) => {
    Reflect.set(globalThis, choiceKey, value);
  },
};
