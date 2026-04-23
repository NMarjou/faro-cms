declare module "nspell" {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): this;
    remove(word: string): this;
    wordCharacters(): string | null;
    dictionary(dic: Buffer | Uint8Array): this;
    personal(dic: string): this;
  }

  function nspell(aff: Buffer | Uint8Array, dic: Buffer | Uint8Array): NSpell;
  function nspell(dictionary: { aff: Buffer | Uint8Array; dic: Buffer | Uint8Array }): NSpell;

  export default nspell;
}
