import { useState } from "react";

import { useHotelConfiguration } from "../features/configuration/useHotelConfiguration";
import type {
  CatalogCategory,
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
  const { configuration, setConfiguration } = useHotelConfiguration();
  const [categoryName, setCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("0");
  const [productCategoryId, setProductCategoryId] = useState("");
  const [breakfastType, setBreakfastType] = useState<"meal" | "beverage">("meal");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const activeCategories = configuration.inventoryCategories.filter(
    (category) => category.enabled,
  );

  function saveCategory(event: React.FormEvent<HTMLFormElement>) {
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

  function saveProduct(event: React.FormEvent<HTMLFormElement>) {
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
    if (
      category.type === "breakfast" &&
      configuration.catalogItems.some(
        (item) =>
          item.category === "breakfast" &&
          item.categoryId === category.id &&
          item.breakfastType === breakfastType &&
          item.label.toLowerCase() === name.toLowerCase() &&
          item.id !== editingProductId,
      )
    ) {
      setNotice("A product with that name already exists for this breakfast type.");
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
    const id = editingProductId ?? `product-${category.id}-${slug(name)}`;
    const product = {
      id,
      label: name,
      category: category.type as CatalogCategory,
      categoryId: category.id,
      ...(category.type === "breakfast" ? { breakfastType } : {}),
      price:
        category.type === "breakfast" || category.type === "amenities"
          ? 0
          : price,
      enabled: true,
      archived: false,
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
    setNotice("Product saved for this session.");
  }

  function editProduct(productId: string) {
    const product = configuration.catalogItems.find(
      (item) => item.id === productId,
    );
    if (!product) return;
    setEditingProductId(product.id);
    setProductName(product.label);
    setProductPrice(String(product.price));
    setProductCategoryId(product.categoryId);
    setBreakfastType(product.breakfastType ?? "meal");
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Catalog
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Inventory</h1>
        <p className="mt-2 text-sm text-slate-600">
          Manage product categories and products. Archiving keeps saved reservation
          descriptions and prices intact. Changes reset when the demo reloads.
        </p>
      </header>

      {notice && (
        <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {notice}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <section className={panel}>
          <h2 className="text-lg font-semibold text-slate-900">Categories</h2>
          <form onSubmit={saveCategory} className="mt-4 flex gap-2">
            <input
              className={input}
              aria-label="Category name"
              placeholder="Category name"
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
            />
            <button className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              {editingCategoryId ? "Save" : "Add category"}
            </button>
          </form>
          <div className="mt-4 divide-y divide-slate-100">
            {configuration.inventoryCategories.map((category) => {
              const products = configuration.catalogItems.filter(
                (product) => product.categoryId === category.id,
              );
              return (
                <div key={category.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium text-slate-900">{category.label}</p>
                    <p className="text-xs text-slate-500">
                      {category.systemDefined
                        ? `Special category · ${category.type}`
                        : `Category · ${products.length} linked product${products.length === 1 ? "" : "s"}`}
                      {!category.enabled ? " · Archived" : ""}
                    </p>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategoryId(category.id);
                        setCategoryName(category.label);
                      }}
                      className="font-semibold text-slate-700 underline underline-offset-2"
                    >
                      Rename
                    </button>
                    {!category.systemDefined && category.enabled && (
                      <>
                        <button
                          type="button"
                          disabled={products.length > 0}
                          title={products.length > 0 ? "Archive categories containing products" : undefined}
                          onClick={() =>
                            setConfiguration((current) => ({
                              ...current,
                              inventoryCategories: current.inventoryCategories.filter(
                                (item) => item.id !== category.id,
                              ),
                            }))
                          }
                          className="font-semibold text-slate-700 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfiguration((current) => ({
                              ...current,
                              inventoryCategories: current.inventoryCategories.map(
                                (item) =>
                                  item.id === category.id
                                    ? { ...item, enabled: false }
                                    : item,
                              ),
                            }))
                          }
                          className="font-semibold text-slate-700 underline underline-offset-2"
                        >
                          Archive
                        </button>
                      </>
                    )}
                    {!category.systemDefined && !category.enabled && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfiguration((current) => ({
                            ...current,
                            inventoryCategories: current.inventoryCategories.map(
                              (item) =>
                                item.id === category.id
                                  ? { ...item, enabled: true }
                                  : item,
                            ),
                          }))
                        }
                        className="font-semibold text-slate-700 underline underline-offset-2"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Special category types are stable and cannot be deleted or reclassified.
          </p>
        </section>

        <section className={panel}>
          <h2 className="text-lg font-semibold text-slate-900">Products</h2>
          <form onSubmit={saveProduct} className="mt-4 grid gap-3 sm:grid-cols-2">
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
            {configuration.inventoryCategories.find(
              (item) => item.id === productCategoryId,
            )?.type === "breakfast" ? (
              <label className="text-sm font-medium text-slate-700">
                <span className="mb-1 block">Breakfast product type</span>
                <select
                  className={input}
                  value={breakfastType}
                  onChange={(event) =>
                    setBreakfastType(event.target.value as "meal" | "beverage")
                  }
                >
                  <option value="meal">Meal</option>
                  <option value="beverage">Beverage</option>
                </select>
              </label>
            ) : configuration.inventoryCategories.find(
                  (item) => item.id === productCategoryId,
                )?.type === "amenities" ? (
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
            <div className="flex items-end gap-2">
              <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                {editingProductId ? "Save product" : "Add product"}
              </button>
              {editingProductId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingProductId(null);
                    setProductName("");
                    setProductPrice("0");
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Product</th>
                  <th className="px-2 py-2">Category</th>
                  <th className="px-2 py-2">Price</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {configuration.catalogItems.map((product) => {
                  const category = configuration.inventoryCategories.find(
                    (item) => item.id === product.categoryId,
                  );
                  const archived = product.archived === true || !product.enabled;
                  return (
                    <tr key={product.id}>
                      <td className="px-2 py-3 font-medium text-slate-900">
                        {product.label}
                        {product.breakfastType ? ` · ${product.breakfastType}` : ""}
                      </td>
                      <td className="px-2 py-3 text-slate-600">{category?.label ?? product.categoryId}</td>
                      <td className="px-2 py-3 text-slate-600">
                        {product.category === "breakfast"
                          ? "Free"
                          : product.category === "amenities"
                            ? "Amenity"
                            : `${product.price.toFixed(2)} ${configuration.currency}`}
                      </td>
                      <td className="px-2 py-3 text-slate-600">{archived ? "Archived" : "Active"}</td>
                      <td className="px-2 py-3 text-right">
                        <div className="inline-flex gap-3">
                          <button
                            type="button"
                            onClick={() => editProduct(product.id)}
                            className="font-semibold underline underline-offset-2"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfiguration((current) => ({
                                ...current,
                                catalogItems: current.catalogItems.map((item) =>
                                  item.id === product.id
                                    ? { ...item, enabled: archived, archived: !archived }
                                    : item,
                                ),
                              }))
                            }
                            className="font-semibold underline underline-offset-2"
                          >
                            {archived ? "Restore" : "Archive"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
