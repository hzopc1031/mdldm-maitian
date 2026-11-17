// Limit display names by Unicode code point, never by half of a surrogate pair.
// Repair malformed imported strings too; source titles and metrics stay unchanged.
export function displayNick(name, nick) {
  const short = String(name ?? '').split(/[｜|]/)[0].trim();
  const value = nick || short.split(/[，,？?！!：:。]/)[0].trim() || short;
  return nick ? String(value).toWellFormed() : Array.from(value.toWellFormed()).slice(0, 16).join('');
}
