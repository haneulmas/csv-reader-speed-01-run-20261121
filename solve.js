// A faster drop-in for csv-reader 1.0.0 (make.fun's own reference CSV reader).
// Same answers on every input, reached a different way: instead of walking the
// text one character at a time, this reader jumps between delimiters with
// indexOf and cuts each field out with slice, so a plain field costs one
// flat copy instead of a character-by-character rope. Records whose whole
// line holds no quote and no stray carriage return are split in one call.
// The broken-row policy is csv-reader's own, kept exactly:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, each CRLF or lone CR inside it reads as LF;
//     what follows the closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character and the text after it is read again
//     as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows are
//     the records after it, each padded (short_row) or cut (long_row) to the
//     first record's width; each error is {code, line, row}, line the 1-based
//     line its record starts on, row its index in rows (null for the header).
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Dependency-free ES module.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

// One scan for the next field delimiter (comma, LF or CR), instead of three
// indexOf calls. A /g regex keeps its scan position in lastIndex, which is
// set before every exec; runs are sequential, so no call overlaps another.
const DELIM = /[,\n\r]/g;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows.
  let recordLine = 1;
  let recordRow = null;

  // What the last readUnquoted call found: the field's value, how it ended
  // and how many characters it kept after the value it started from.
  let uVal = '';
  let uEnd = COMMA;
  let uAdd = 0;

  function finishRecord(fields, quoted) {
    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  // Reads an unquoted field starting at pos, onto `value` (which may already
  // hold the start of the field, for junk after a closing quote and for the
  // re-read of an unterminated quote). The result lands in uVal, uEnd and
  // uAdd, so no array is built per field; uAdd counts the characters kept
  // after `value`'s start.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      DELIM.lastIndex = pos;
      const hit = DELIM.exec(text);
      const m = hit === null ? -1 : hit.index;
      if (m === -1) {
        if (pos < n) {
          value += text.slice(pos, n);
          added += n - pos;
        }
        pos = n;
        uVal = value;
        uEnd = END;
        uAdd = added;
        return;
      }
      if (m > pos) {
        value += text.slice(pos, m);
        added += m - pos;
      }
      const d = text.charCodeAt(m);
      if (d === 44) {
        pos = m + 1;
        uVal = value;
        uEnd = COMMA;
        uAdd = added;
        return;
      }
      if (d === 10) {
        pos = m + 1;
        line += 1;
        uVal = value;
        uEnd = LINE_BREAK;
        uAdd = added;
        return;
      }
      // A CR: CRLF ends the field at a line break, a lone CR is dropped.
      if (text.charCodeAt(m + 1) === 10) {
        pos = m + 2;
        line += 1;
        uVal = value;
        uEnd = LINE_BREAK;
        uAdd = added;
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = m + 1;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record ends on this line, and the line holds no quote
    // and no stray CR (a trailing CR is the CRLF ending the line). Then the
    // whole record is one split on commas.
    const lf = text.indexOf('\n', pos);
    const lineEnd = lf === -1 ? n : lf;
    const qAt = text.indexOf('"', pos);
    const rAt = text.indexOf('\r', pos);
    const hasQuote = qAt !== -1 && qAt < lineEnd;
    // A trailing CR is the CRLF ending the line only when a LF follows it;
    // at the end of the text it is a lone CR, which the slow path drops.
    const crlfOnly = rAt === -1 || rAt >= lineEnd || (lf !== -1 && rAt === lineEnd - 1);
    if (!hasQuote && crlfOnly) {
      const stop = rAt === lineEnd - 1 ? lineEnd - 1 : lineEnd;
      const lineText = text.slice(pos, stop);
      pos = lf === -1 ? n : lf + 1;
      line += 1;
      if (lineText === '') continue;
      finishRecord(lineText.split(','), false);
      continue;
    }

    // Slow path: at least one field needs the full broken-row policy.
    const fields = [];
    let quoted = false;
    let ended = COMMA;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        const openLine = line;
        // Find the closing quote: a quote doubled ("") is one literal quote.
        let segStart = open + 1;
        let searchFrom = open + 1;
        let parts = null;
        let closedAt = -1;
        for (;;) {
          const q = text.indexOf('"', searchFrom);
          if (q === -1) break;
          if (text.charCodeAt(q + 1) === 34) {
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, q));
            segStart = q + 2;
            searchFrom = q + 2;
            continue;
          }
          closedAt = q;
          break;
        }
        if (closedAt === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          readUnquoted('"');
          fields.push(uVal);
          ended = uEnd;
          continue;
        }
        let raw;
        if (parts === null) {
          raw = text.slice(open + 1, closedAt);
        } else {
          parts.push(text.slice(segStart, closedAt));
          raw = parts.join('"');
        }
        // Each CRLF or lone CR inside the quotes reads as one LF, and each
        // line break inside counts toward the line.
        let value = raw;
        if (raw.indexOf('\r') !== -1 || raw.indexOf('\n') !== -1) {
          const breaks = raw.match(/\r\n|\r|\n/g);
          line += breaks === null ? 0 : breaks.length;
          value = raw.replace(/\r\n?/g, '\n');
        }
        pos = closedAt + 1;
        if (pos >= n) {
          fields.push(value);
          ended = END;
          continue;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos += 1;
          fields.push(value);
          ended = COMMA;
          continue;
        }
        if (c === 10) {
          pos += 1;
          line += 1;
          fields.push(value);
          ended = LINE_BREAK;
          continue;
        }
        if (c === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fields.push(value);
          ended = LINE_BREAK;
          continue;
        }
        // What follows the closing quote is appended as it stands, up to
        // the next comma or line break.
        readUnquoted(value);
        if (uAdd > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(uVal);
        ended = uEnd;
      } else {
        quoted = false;
        readUnquoted('');
        fields.push(uVal);
        ended = uEnd;
      }
    } while (ended === COMMA);

    finishRecord(fields, quoted);
  }

  return { columns: header ? columns ?? [] : null, rows, errors };
}
