export type Choice = Readonly<{
  get: () => boolean | undefined;
  set: (value: boolean) => void;
}>;

// The `/auto` choice outlives the extension runtime.
const choiceKey = Symbol.for("pi-tweaks.auto.enabled");

export const processChoice: Choice = {
  get: () => {
    const value: unknown = Reflect.get(globalThis, choiceKey);
    return typeof value === "boolean" ? value : undefined;
  },
  set: (value) => {
    Reflect.set(globalThis, choiceKey, value);
  },
};
