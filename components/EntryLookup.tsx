"use client";

export type LookupHit = {
  id: string;
  title: string;
  snippet: string;
};

export function plainSnippet(value: string, limit = 80) {
  const text = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

/** Search box that lists saved entries for the current writing screen. */
export function EntryLookup({
  placeholder,
  query,
  onQuery,
  onSearch,
  hits,
  status,
  onOpen,
}: {
  placeholder: string;
  query: string;
  onQuery: (value: string) => void;
  onSearch: () => void;
  hits: LookupHit[];
  status: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="entryLookup">
      <div className="entryLookupRow">
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSearch();
          }}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <button type="button" onClick={onSearch}>
          조회
        </button>
      </div>
      {status ? <p className="entryLookupStatus">{status}</p> : null}
      {hits.length > 0 ? (
        <div className="entryLookupHits">
          {hits.map((hit) => (
            <button type="button" key={hit.id} onClick={() => onOpen(hit.id)}>
              <strong>{hit.title}</strong>
              {hit.snippet ? <span>{hit.snippet}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
