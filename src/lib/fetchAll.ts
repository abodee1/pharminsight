// Helper to bypass Supabase's default 1000-row select cap by paginating.
// Usage:
//   const rows = await fetchAll((from, to) =>
//     supabase.from("dispensing_data").select("*").range(from, to)
//   );
type Page<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // hard ceiling to avoid runaway loops
  for (let i = 0; i < 200; i++) {
    const to = from + pageSize - 1;
    const { data, error } = await query(from, to);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
