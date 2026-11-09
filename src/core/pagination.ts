/**
 * Cursor pagination (`limit`, `starting_after`, `has_more`). A list call returns
 * a PagePromise: await it for one page, or iterate it for every item across
 * pages.
 *
 *   const page = await reeds.shipping.deliveries.list({ limit: 50 });
 *   for await (const delivery of reeds.shipping.deliveries.list()) { ... }
 */

export type ListParams = { limit?: number; starting_after?: string };

/** Anything a list returns: each object has an id, the cursor for the next page. */
type Listed = { id?: string | undefined };

export class Page<T extends Listed> implements AsyncIterable<T> {
  constructor(
    /** This page's objects, newest first. */
    readonly data: T[],
    /** True when another page follows. */
    readonly has_more: boolean,
    private readonly fetchAfter: (startingAfter: string) => Promise<Page<T>>,
  ) {}

  /** The next page, or null on the last one. */
  async nextPage(): Promise<Page<T> | null> {
    const last = this.data[this.data.length - 1]?.id;
    if (!this.has_more || !last) return null;
    return this.fetchAfter(last);
  }

  /** Every object from this page on, fetching the following pages as needed. */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page: Page<T> | null = this;
    while (page) {
      for (const item of page.data) yield item;
      page = await page.nextPage();
    }
  }
}

export class PagePromise<T extends Listed> implements PromiseLike<Page<T>>, AsyncIterable<T> {
  private loaded: Promise<Page<T>> | undefined;

  constructor(private readonly load: () => Promise<Page<T>>) {}

  private page(): Promise<Page<T>> {
    this.loaded ??= this.load();
    return this.loaded;
  }

  then<A = Page<T>, B = never>(onFulfilled?: ((page: Page<T>) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.page().then(onFulfilled, onRejected);
  }

  catch<B = never>(onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<Page<T> | B> {
    return this.page().catch(onRejected);
  }

  finally(onFinally?: (() => void) | null): Promise<Page<T>> {
    return this.page().finally(onFinally);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    yield* await this.page();
  }
}
