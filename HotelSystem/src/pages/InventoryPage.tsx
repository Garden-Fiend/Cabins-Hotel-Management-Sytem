import { BreakfastEligibilityEditor } from "../features/inventory/BreakfastEligibilityEditor";
import { useState } from "react";
import { useReservationDemo } from "../app/useReservationDemo";
import { phpDecimal, formatPhp } from "../app/api/presentation";
import { InventoryDialog } from "../features/inventory/InventoryDialog";

import { useHotelConfiguration } from "../features/configuration/useHotelConfiguration";
import type {
  CatalogCategory,
  CatalogConfiguration,
  InventoryCategoryConfiguration,
} from "../features/configuration/types";

const panel =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const input =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

function slug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function InventoryPage() {
  const { mode, commands } = useReservationDemo();
  const persistent = mode === "api";
  const [saving, setSaving] = useState(false);
  const [editingCategoryVersion, setEditingCategoryVersion] = useState<number>();
  const [editingProductVersion, setEditingProductVersion] = useState<number>();
  const { configuration, setConfiguration } = useHotelConfiguration();
  const [categoryName, setCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("0");
  const [productCategoryId, setProductCategoryId] = useState("");
  const [availableForSale, setAvailableForSale] = useState(true);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [breakfastDialogOpen, setBreakfastDialogOpen] = useState(false);
  const selectedProduct = configuration.catalogItems.find((item) => item.id === editingProductId);
  const selectedProductCategory = configuration.inventoryCategories.find((item) => item.id === productCategoryId);
  const money = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: configuration.currency }).format(amount);
  const visibleCategories = configuration.inventoryCategories.filter((item) => showArchived || item.enabled);
  const filteredProducts = configuration.catalogItems.filter((product) => {
    const category = configuration.inventoryCategories.find((item) => item.id === product.categoryId);
    return (showArchived || (product.enabled && !product.archived && category?.enabled)) &&
      (selectedCategoryId === "all" || product.categoryId === selectedCategoryId || (selectedCategoryId === "special-breakfast" && configuration.breakfastEligibleItems?.some((item) => item.inventoryItemId === product.id && item.enabled))) &&
      `${product.label} ${category?.label ?? ""} ${product.breakfastType ?? ""}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  function openNewProduct() {
    setEditingProductId(null); setProductName(""); setProductPrice("0");
    setProductCategoryId(activeCategories.some((item) => item.id === selectedCategoryId) ? selectedCategoryId : "");
    setAvailableForSale(true); setNotice(""); setProductDialogOpen(true);
  }

  async function toggleProduct(product: CatalogConfiguration) {
    const archived = product.archived || !product.enabled;
    if (persistent) {
      setSaving(true);
      try {
        await commands!.saveDefinition!("catalogItems", product.id, { label: product.label, categoryId: product.categoryId,
          price: product.serverUnitAmountMinor === undefined ? String(product.price) : phpDecimal(product.serverUnitAmountMinor), availableForSale: product.availableForSale ?? false, enabled: Boolean(archived), archived: !archived }, editingProductVersion);
        setProductDialogOpen(false); setNotice("Product change committed to PostgreSQL.");
      } catch (error) { setNotice(error instanceof Error ? error.message : "Save not confirmed. Draft retained."); }
      finally { setSaving(false); }
      return;
    }
    setConfiguration((current) => ({ ...current, catalogItems: current.catalogItems.map((item) => item.id === product.id ? { ...item, enabled: Boolean(archived), archived: !archived } : item) }));
    setProductDialogOpen(false);
    setNotice(`${product.label} ${archived ? "restored" : "archived"}.`);
  }

  async function toggleCategory(category: InventoryCategoryConfiguration) {
    if (persistent) {
      setSaving(true);
      try {
        await commands!.saveDefinition!("inventoryCategories", category.id,
          { label: category.label, type: category.type, enabled: !category.enabled }, category.serverVersion);
        if (selectedCategoryId === category.id && category.enabled) setSelectedCategoryId("all");
        setNotice("Category change committed to PostgreSQL.");
      } catch (error) { setNotice(error instanceof Error ? error.message : "Save not confirmed. Draft retained."); }
      finally { setSaving(false); }
      return;
    }
    setConfiguration(current => ({ ...current, inventoryCategories: current.inventoryCategories.map(item => item.id === category.id ? { ...item, enabled: !item.enabled } : item) }));
    if (selectedCategoryId === category.id && category.enabled) setSelectedCategoryId("all");
  }


  const activeCategories = configuration.inventoryCategories.filter(
    (category) => category.enabled && category.type !== "breakfast",
  );

  async function saveCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = categoryName.trim();
    if (!label) {
      setNotice("Enter a category name.");
      return;
    }
    const duplicate = configuration.inventoryCategories.some(
      (category) =>
        category.label.toLowerCase() === label.toLowerCase() &&
        category.id !== editingCategoryId,
    );
    if (duplicate) {
      setNotice("A category with that name already exists.");
      return;
    }
    if (persistent) {
      setSaving(true);
      const previous = configuration.inventoryCategories.find(c => c.id === editingCategoryId);
      try {
        await commands!.saveDefinition!("inventoryCategories", editingCategoryId ?? undefined,
          { label, type: previous?.type ?? "ordinary", enabled: previous?.enabled ?? true }, editingCategoryVersion);
        setCategoryName(""); setEditingCategoryId(null); setNotice("Category committed to PostgreSQL.");
      } catch (error) { setNotice(error instanceof Error ? error.message : "Save not confirmed. Draft retained."); }
      finally { setSaving(false); }
      return;
    }
    if (editingCategoryId) {
      setConfiguration((current) => ({
        ...current,
        inventoryCategories: current.inventoryCategories.map((category) =>
          category.id === editingCategoryId
            ? { ...category, label }
            : category,
        ),
      }));
    } else {
      const id = `category-${slug(label)}`;
      const category: InventoryCategoryConfiguration = {
        id: configuration.inventoryCategories.some((item) => item.id === id)
          ? `${id}-${Date.now()}`
          : id,
        label,
        type: "ordinary",
        enabled: true,
        systemDefined: false,
      };
      setConfiguration((current) => ({
        ...current,
        inventoryCategories: [...current.inventoryCategories, category],
      }));
    }
    setCategoryName("");
    setEditingCategoryId(null);
    setNotice("Category saved for this session.");
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = productName.trim();
    const category = configuration.inventoryCategories.find(
      (item) => item.id === productCategoryId && item.enabled,
    );
    const price = Number(productPrice);
    if (!name || !category || !Number.isFinite(price) || price < 0) {
      setNotice("Enter a product name, active category, and valid non-negative price.");
      return;
    }
    const duplicate = configuration.catalogItems.some(
      (item) =>
        item.categoryId === category.id &&
        item.label.toLowerCase() === name.toLowerCase() &&
        item.id !== editingProductId,
    );
    if (duplicate) {
      setNotice("A product with that name already exists in this category.");
      return;
    }
    if (persistent) {
      setSaving(true);
      const previous = configuration.catalogItems.find(p => p.id === editingProductId);
      try {
        await commands!.saveDefinition!("catalogItems", editingProductId ?? undefined, { label: name, categoryId: category.id,
          price: category.type === "amenities" ? "0" : productPrice, availableForSale: category.type === "ordinary" && availableForSale,
          enabled: previous?.enabled ?? true, archived: previous?.archived ?? false }, editingProductVersion);
        setProductDialogOpen(false); setProductName(""); setProductPrice("0"); setEditingProductId(null);
        setSelectedCategoryId(category.id); setNotice("Product committed to PostgreSQL.");
      } catch (error) { setNotice(error instanceof Error ? error.message : "Save not confirmed. Draft retained."); }
      finally { setSaving(false); }
      return;
    }
    const id = editingProductId ?? `product-${category.id}-${slug(name)}`;
    const existing = configuration.catalogItems.find((item) => item.id === editingProductId);
    const product = {
      id,
      label: name,
      category: category.type as CatalogCategory,
      categoryId: category.id,
      availableForSale: category.type === "ordinary" && availableForSale,
      price:
        category.type === "amenities"
          ? 0
          : price,
      enabled: existing?.enabled ?? true,
      archived: existing?.archived ?? false,
    };
    setConfiguration((current) => ({
      ...current,
      catalogItems: current.catalogItems.some((item) => item.id === id)
        ? current.catalogItems.map((item) => (item.id === id ? product : item))
        : [...current.catalogItems, product],
    }));
    setProductName("");
    setProductPrice("0");
    setEditingProductId(null);
    setProductDialogOpen(false);
    setSelectedCategoryId(category.id);
    setNotice("Product saved for this session.");
  }

  function editProduct(productId: string) {
    const product = configuration.catalogItems.find(
      (item) => item.id === productId,
    );
    if (!product) return;
    setEditingProductId(product.id);
    setEditingProductVersion(product.serverVersion);
    setProductName(product.label);
    setProductPrice(product.serverUnitAmountMinor === undefined ? String(product.price) : phpDecimal(product.serverUnitAmountMinor));
    setProductCategoryId(product.categoryId);
    setAvailableForSale(product.availableForSale !== false);
    setNotice(""); setProductDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Catalog</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Inventory</h1>
          <p className="mt-2 text-sm text-slate-600">Browse products by category. Select an item to view and edit its details.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setCategoryName(""); setEditingCategoryId(null); setNotice(""); setCategoryDialogOpen(true); }} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Manage categories</button>
          <button type="button" onClick={openNewProduct} className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Add product</button>
        </div>
      </header>

      {notice && !productDialogOpen && !categoryDialogOpen && <p role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{notice}</p>}

      <section className={panel} aria-label="Inventory catalog">
        <label className="block text-sm font-medium text-slate-700">
          <span className="mb-2 block">Search inventory</span>
          <input type="search" className={`${input} max-w-2xl`} placeholder="Search items or categories..." value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>

        <div className="mt-5 border-b border-slate-200 pb-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Categories</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
            {[{ id: "all", label: "All items", enabled: true }, ...visibleCategories].map((category) => {
              const count = configuration.catalogItems.filter((product) => (category.id === "all" || product.categoryId === category.id || (category.id === "special-breakfast" && configuration.breakfastEligibleItems?.some((item) => item.inventoryItemId === product.id && item.enabled))) && (showArchived || (product.enabled && !product.archived && configuration.inventoryCategories.some((item) => item.id === product.categoryId && item.enabled)))).length;
              return <button key={category.id} type="button" aria-pressed={selectedCategoryId === category.id} onClick={() => setSelectedCategoryId(category.id)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 ${selectedCategoryId === category.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100"}`}>
                {category.label}{!category.enabled ? " (archived)" : ""}
                <span aria-hidden="true" className={`rounded-full px-2 py-0.5 text-xs ${selectedCategoryId === category.id ? "bg-white/15" : "bg-white text-slate-500"}`}>{count}</span>
              </button>;
            })}
          </div>
        </div>

        {selectedCategoryId === "special-breakfast" && <button type="button" disabled={persistent} title={persistent ? "Breakfast persistence is not supported yet" : undefined} onClick={() => setBreakfastDialogOpen(true)} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Configure breakfast</button>}

        <div className="my-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700">{filteredProducts.length} item{filteredProducts.length === 1 ? "" : "s"}{selectedCategoryId !== "all" ? ` in ${configuration.inventoryCategories.find((item) => item.id === selectedCategoryId)?.label ?? "category"}` : " in catalog"}</h2>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showArchived} onChange={(event) => { setShowArchived(event.target.checked); if (!event.target.checked && !activeCategories.some((item) => item.id === selectedCategoryId)) setSelectedCategoryId("all"); }} />Show archived</label>
        </div>

        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {filteredProducts.map((product) => {
            const category = configuration.inventoryCategories.find((item) => item.id === product.categoryId);
            const archived = product.archived || !product.enabled;
            return <button key={product.id} type="button" aria-label={`View ${product.label}`} onClick={() => editProduct(product.id)}
              className="group overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 motion-reduce:transform-none">
              <div className="relative p-3">
                <InventoryItemArtwork category={product.category} />
                <span className="absolute right-5 top-5 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{archived ? "Archived" : "Active"}</span>
              </div>
              <div className="space-y-1 px-4 pb-4">
                <p className="text-xs font-medium text-slate-500">{category?.label ?? product.categoryId}</p>
                <h3 className="font-semibold text-slate-900">{product.label}{product.breakfastType ? ` · ${product.breakfastType}` : ""}</h3>
                <div className="flex items-center justify-between gap-2 pt-2">
                  <span className="text-sm font-semibold text-slate-900">{product.category === "amenities" ? "Amenity" : product.serverUnitAmountMinor === undefined ? money(product.price) : formatPhp(product.serverUnitAmountMinor)}</span>
                  <span aria-hidden="true" className="text-slate-400 transition group-hover:translate-x-1">→</span>
                </div>
              </div>
            </button>;
          })}
        </div>
        {!filteredProducts.length && <div className="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center"><h3 className="font-semibold text-slate-700">No items found</h3><p className="mt-2 text-sm text-slate-500">Try another search or category, or add a product.</p></div>}
      </section>

      {productDialogOpen && <InventoryDialog title={selectedProduct ? `Item details: ${selectedProduct.label}` : "Add product"} onClose={() => !saving && setProductDialogOpen(false)}><fieldset disabled={saving} className="min-w-0">
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <aside className="space-y-4">
            <InventoryItemArtwork category={selectedProductCategory?.type ?? "ordinary"} large />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{selectedProductCategory?.label ?? "New catalog item"}</p>
              <h3 className="mt-2 text-xl font-bold text-slate-900">{productName || "New product"}</h3>
              <p className="mt-2 text-lg font-semibold text-slate-700">{selectedProductCategory?.type === "amenities" ? "Amenity" : money(Number(productPrice) || 0)}</p>
              {selectedProduct && <span className="mt-3 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{selectedProduct.archived || !selectedProduct.enabled ? "Archived" : "Active"}</span>}
            </div>
            {selectedProduct && <button type="button" onClick={() => toggleProduct(selectedProduct)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{selectedProduct.archived || !selectedProduct.enabled ? "Restore" : "Archive"}</button>}
          </aside>
          <div className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Item information</p><p className="mt-2 text-sm text-slate-600">Update the name, category, and price for this catalog item.</p></div>
            {notice && <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{notice}</p>}
          <form onSubmit={saveProduct} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Product name</span>
              <input
                className={input}
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                required
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Category</span>
              <select
                className={input}
                value={productCategoryId}
                onChange={(event) => setProductCategoryId(event.target.value)}
                required
              >
                <option value="">Choose category</option>
                {activeCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            {selectedProductCategory?.type === "amenities" ? (
              <p className="text-sm text-slate-500 sm:col-span-2">
                Amenity catalog items do not have a price.
              </p>
            ) : (
              <label className="text-sm font-medium text-slate-700">
                <span className="mb-1 block">Unit price ({configuration.currency})</span>
                <input
                  className={input}
                  type="number"
                  min="0"
                  step="0.01"
                  value={productPrice}
                  onChange={(event) => setProductPrice(event.target.value)}
                  required
                />
              </label>
            )}
            {selectedProductCategory?.type === "ordinary" && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={availableForSale} onChange={(event) => setAvailableForSale(event.target.checked)} />Available for sale</label>}
            <div className="flex items-end gap-2">
              <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                {editingProductId ? "Save product" : "Add product"}
              </button>
              {(
                <button
                  type="button"
                  onClick={() => {
                    setProductDialogOpen(false);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          </div>
        </div>
      </fieldset></InventoryDialog>}

      {breakfastDialogOpen && !persistent && <InventoryDialog title="Breakfast Configuration" onClose={() => setBreakfastDialogOpen(false)}><BreakfastEligibilityEditor /></InventoryDialog>}

      {categoryDialogOpen && <InventoryDialog title="Manage categories" onClose={() => !saving && setCategoryDialogOpen(false)}><fieldset disabled={saving}>
        <form onSubmit={saveCategory} className="mt-5 flex flex-wrap gap-2">
          <input className={input} aria-label="Category name" placeholder="Category name" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
          <button className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">{editingCategoryId ? "Save" : "Add category"}</button>
          {editingCategoryId && <button type="button" onClick={() => { setEditingCategoryId(null); setCategoryName(""); }} className="text-sm underline">Cancel</button>}
        </form>
        {notice && <p role="status" className="mt-3 rounded-lg bg-slate-100 p-3 text-sm">{notice}</p>}
        <div className="mt-5 space-y-3">
          {configuration.inventoryCategories.map((category) => {
            const products = configuration.catalogItems.filter((product) => product.categoryId === category.id);
            return <article key={category.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
              <div><h3 className="font-semibold text-slate-900">{category.label}</h3><p className="mt-1 text-xs text-slate-500">{category.systemDefined ? `Special category · ${category.type}` : `${products.length} linked products`}{!category.enabled ? " · Archived" : ""}</p></div>
              <div className="flex gap-3 text-sm">
                {category.type === "breakfast" && <button type="button" disabled={persistent} onClick={() => { setCategoryDialogOpen(false); setBreakfastDialogOpen(true); }} className="font-semibold text-slate-700 underline">Configure breakfast</button>}
                <button type="button" onClick={() => { setEditingCategoryId(category.id); setEditingCategoryVersion(category.serverVersion); setCategoryName(category.label); }} className="font-semibold text-slate-700 underline">Rename</button>
                {!category.systemDefined && <>
                  {category.enabled && <button type="button" disabled={persistent || products.length > 0} title={persistent ? "Persistent categories can be archived; deletion is unavailable" : products.length ? "Archive categories containing products" : undefined} onClick={() => {
                    setConfiguration((current) => ({ ...current, inventoryCategories: current.inventoryCategories.filter((item) => item.id !== category.id) }));
                    if (selectedCategoryId === category.id) setSelectedCategoryId("all");
                    if (editingCategoryId === category.id) { setEditingCategoryId(null); setCategoryName(""); }
                  }} className="font-semibold text-slate-700 underline disabled:opacity-40">Delete</button>}
                  <button type="button" onClick={() => void toggleCategory(category)} className="font-semibold text-slate-700 underline">{category.enabled ? "Archive" : "Restore"}</button>
                </>}
              </div>
            </article>;
          })}
        </div>
        <p className="mt-4 text-xs text-slate-500">Special category types are stable and cannot be deleted or reclassified.</p>
      </fieldset></InventoryDialog>}
    </div>
  );
}

function InventoryItemArtwork({ category, large = false }: { category: CatalogCategory; large?: boolean }) {
  const colors: Record<CatalogCategory, string> = {
    inclusion: "bg-emerald-50 text-emerald-700", extra: "bg-amber-50 text-amber-700",
    breakfast: "bg-orange-50 text-orange-700", amenities: "bg-sky-50 text-sky-700", ordinary: "bg-violet-50 text-violet-700",
  };
  return <div aria-hidden="true" className={`flex items-center justify-center rounded-xl ${large ? "aspect-square" : "h-32"} ${colors[category]}`}>
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={large ? "size-24" : "size-16"}>
      {category === "breakfast" ? <><path d="M10 18h22v13a9 9 0 0 1-9 9h-4a9 9 0 0 1-9-9V18Z" /><path d="M32 20h3a6 6 0 0 1 0 12h-3M17 7v5m7-7v7m-18 30h32" /></> : category === "amenities" ? <><path d="M8 18a24 24 0 0 1 32 0M14 25a15 15 0 0 1 20 0M20 32a6 6 0 0 1 8 0" /><circle cx="24" cy="39" r="1.5" /></> : <><path d="m24 7 16 9v18l-16 9-16-9V16l16-9Z" /><path d="m8 16 16 9 16-9M24 25v18M16 11l16 9v8" /></>}
    </svg>
  </div>;
}
