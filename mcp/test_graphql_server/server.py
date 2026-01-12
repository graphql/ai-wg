import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

from graphql import build_schema, graphql_sync


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "content-type, authorization")
    handler.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("content-length") or "0")
    raw = handler.rfile.read(length) if length else b""
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


class Root:
    def __init__(self) -> None:
        self.addresses = {
            "addr_1": {
                "id": "addr_1",
                "line1": "123 Main St",
                "line2": "Apt 4B",
                "city": "London",
                "region": "LDN",
                "postalCode": "N1 1AA",
                "country": "UK",
            },
            "addr_2": {
                "id": "addr_2",
                "line1": "500 Market St",
                "line2": None,
                "city": "San Francisco",
                "region": "CA",
                "postalCode": "94105",
                "country": "US",
            },
            "addr_3": {
                "id": "addr_3",
                "line1": "9 Orchard Rd",
                "line2": None,
                "city": "Oxford",
                "region": "OXF",
                "postalCode": "OX1 2JD",
                "country": "UK",
            },
            "addr_4": {
                "id": "addr_4",
                "line1": "Warehouse Way 1",
                "line2": None,
                "city": "Bristol",
                "region": "BST",
                "postalCode": "BS1 4ZZ",
                "country": "UK",
            },
        }

        self.companies = {
            "co_1": {"id": "co_1", "name": "Analytical Engines", "address": self.addresses["addr_3"]},
            "co_2": {"id": "co_2", "name": "Compilers United", "address": self.addresses["addr_2"]},
        }

        self.categories = {
            "cat_0": {"id": "cat_0", "name": "All", "parent": None, "children": [], "products": []},
            "cat_1": {"id": "cat_1", "name": "Shoes", "parent": None, "children": [], "products": []},
            "cat_2": {"id": "cat_2", "name": "Apparel", "parent": None, "children": [], "products": []},
            "cat_3": {"id": "cat_3", "name": "Kitchen", "parent": None, "children": [], "products": []},
            "cat_4": {"id": "cat_4", "name": "Accessories", "parent": None, "children": [], "products": []},
        }

        self.categories["cat_1"]["parent"] = self.categories["cat_0"]
        self.categories["cat_2"]["parent"] = self.categories["cat_0"]
        self.categories["cat_3"]["parent"] = self.categories["cat_0"]
        self.categories["cat_4"]["parent"] = self.categories["cat_0"]
        self.categories["cat_0"]["children"] = [
            self.categories["cat_1"],
            self.categories["cat_2"],
            self.categories["cat_3"],
            self.categories["cat_4"],
        ]

        self.products = {
            "p_1": {
                "id": "p_1",
                "name": "Red Shoes",
                "description": "Comfortable running shoes",
                "price": 79.99,
                "inStock": True,
                "tags": ["shoes", "running", "red"],
                "category": self.categories["cat_1"],
                "reviews": [],
                "related": [],
                "inventory": [
                    {
                        "id": "inv_p1_w",
                        "name": "Warehouse West",
                        "status": "IN_STOCK",
                        "quantity": 42,
                        "address": self.addresses["addr_4"],
                    },
                    {
                        "id": "inv_p1_e",
                        "name": "Warehouse East",
                        "status": "LOW_STOCK",
                        "quantity": 6,
                        "address": self.addresses["addr_2"],
                    },
                ],
            },
            "p_2": {
                "id": "p_2",
                "name": "Blue Jacket",
                "description": "Lightweight outdoor jacket",
                "price": 129.5,
                "inStock": True,
                "tags": ["jacket", "outdoor", "blue"],
                "category": self.categories["cat_2"],
                "reviews": [],
                "related": [],
                "inventory": [
                    {
                        "id": "inv_p2_w",
                        "name": "Warehouse West",
                        "status": "IN_STOCK",
                        "quantity": 30,
                        "address": self.addresses["addr_4"],
                    }
                ],
            },
            "p_3": {
                "id": "p_3",
                "name": "Coffee Mug",
                "description": "Ceramic mug 350ml",
                "price": 12.0,
                "inStock": False,
                "tags": ["mug", "kitchen", "ceramic"],
                "category": self.categories["cat_3"],
                "reviews": [],
                "related": [],
                "inventory": [
                    {
                        "id": "inv_p3_w",
                        "name": "Warehouse West",
                        "status": "OUT_OF_STOCK",
                        "quantity": 0,
                        "address": self.addresses["addr_4"],
                    }
                ],
            },
            "p_4": {
                "id": "p_4",
                "name": "Trail Backpack",
                "description": "20L daypack with rain cover",
                "price": 89.0,
                "inStock": True,
                "tags": ["backpack", "outdoor"],
                "category": self.categories["cat_4"],
                "reviews": [],
                "related": [],
                "inventory": [
                    {
                        "id": "inv_p4_e",
                        "name": "Warehouse East",
                        "status": "IN_STOCK",
                        "quantity": 15,
                        "address": self.addresses["addr_2"],
                    }
                ],
            },
            "p_5": {
                "id": "p_5",
                "name": "Running Socks",
                "description": "Breathable ankle socks",
                "price": 6.0,
                "inStock": True,
                "tags": ["socks", "running"],
                "category": self.categories["cat_1"],
                "reviews": [],
                "related": [],
                "inventory": [
                    {
                        "id": "inv_p5_w",
                        "name": "Warehouse West",
                        "status": "IN_STOCK",
                        "quantity": 120,
                        "address": self.addresses["addr_4"],
                    }
                ],
            },
        }

        self.products["p_1"]["related"] = [self.products["p_5"], self.products["p_2"]]
        self.products["p_2"]["related"] = [self.products["p_4"]]
        self.products["p_3"]["related"] = []
        self.products["p_4"]["related"] = [self.products["p_2"]]
        self.products["p_5"]["related"] = [self.products["p_1"]]

        for product in self.products.values():
            category = product.get("category")
            if category:
                category["products"].append(product)
                self.categories["cat_0"]["products"].append(product)

        self.discounts = {
            "WELCOME10": {"code": "WELCOME10", "amount": 10.0, "description": "Welcome discount"},
            "SHIPFREE": {"code": "SHIPFREE", "amount": 5.0, "description": "Free shipping"},
        }

        self.carriers = {
            "car_1": {"id": "car_1", "name": "PostShip", "phone": "+44-20-5550-1000"},
            "car_2": {"id": "car_2", "name": "FastTrack", "phone": "+1-415-555-0111"},
        }

        self.shipments = {
            "s_1": {
                "carrier": self.carriers["car_1"],
                "trackingNumber": "TRK123",
                "address": self.addresses["addr_1"],
                "trackingEvents": [
                    {"status": "LABEL_CREATED", "timestamp": "2024-01-01T12:00:00Z", "location": "London"},
                    {"status": "IN_TRANSIT", "timestamp": "2024-01-02T09:00:00Z", "location": "Birmingham"},
                    {"status": "DELIVERED", "timestamp": "2024-01-03T16:10:00Z", "location": "London"},
                ],
            },
            "s_2": {
                "carrier": self.carriers["car_2"],
                "trackingNumber": "TRK456",
                "address": self.addresses["addr_2"],
                "trackingEvents": [
                    {"status": "LABEL_CREATED", "timestamp": "2024-01-06T09:30:00Z", "location": "San Francisco"},
                    {"status": "IN_TRANSIT", "timestamp": "2024-01-06T14:20:00Z", "location": "Oakland"},
                ],
            },
        }

        self.payments = {
            "pay_1": {
                "id": "pay_1",
                "method": "CARD",
                "status": "CAPTURED",
                "amount": 93.99,
                "processedAt": "2024-01-01T10:02:00Z",
                "billingAddress": self.addresses["addr_1"],
            },
            "pay_2": {
                "id": "pay_2",
                "method": "PAYPAL",
                "status": "AUTHORIZED",
                "amount": 142.5,
                "processedAt": "2024-01-06T12:35:00Z",
                "billingAddress": self.addresses["addr_2"],
            },
        }

        self.orders = {
            "o_1": {
                "id": "o_1",
                "status": "SHIPPED",
                "items": [
                    {
                        "product": self.products["p_1"],
                        "quantity": 1,
                        "subtotal": 79.99,
                        "appliedDiscounts": [self.discounts["WELCOME10"]],
                    },
                    {
                        "product": self.products["p_3"],
                        "quantity": 2,
                        "subtotal": 24.0,
                        "appliedDiscounts": [],
                    },
                ],
                "total": 93.99,
                "placedAt": "2024-01-01T10:00:00Z",
                "shipment": self.shipments["s_1"],
                "payment": self.payments["pay_1"],
                "discounts": [self.discounts["WELCOME10"]],
                "notes": ["Leave at front desk"],
            },
            "o_2": {
                "id": "o_2",
                "status": "PENDING",
                "items": [
                    {
                        "product": self.products["p_2"],
                        "quantity": 1,
                        "subtotal": 129.5,
                        "appliedDiscounts": [],
                    },
                    {
                        "product": self.products["p_5"],
                        "quantity": 3,
                        "subtotal": 18.0,
                        "appliedDiscounts": [self.discounts["SHIPFREE"]],
                    },
                ],
                "total": 142.5,
                "placedAt": "2024-01-06T12:30:00Z",
                "shipment": self.shipments["s_2"],
                "payment": self.payments["pay_2"],
                "discounts": [self.discounts["SHIPFREE"]],
                "notes": [],
            },
        }

        self.user_store = {
            "u_1": {
                "id": "u_1",
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "profile": {
                    "bio": "Mathematician and early computing pioneer.",
                    "joinedAt": "2023-11-20T08:00:00Z",
                    "preferences": {
                        "newsletter": True,
                        "favoriteCategories": [self.categories["cat_1"], self.categories["cat_4"]],
                    },
                },
                "address": self.addresses["addr_1"],
                "company": self.companies["co_1"],
                "orders": [self.orders["o_1"]],
                "wishlist": [self.products["p_2"], self.products["p_4"]],
                "reviews": [],
            },
            "u_2": {
                "id": "u_2",
                "name": "Grace Hopper",
                "email": "grace@example.com",
                "profile": {
                    "bio": "Compiler trailblazer.",
                    "joinedAt": "2023-12-01T09:30:00Z",
                    "preferences": {
                        "newsletter": False,
                        "favoriteCategories": [self.categories["cat_2"]],
                    },
                },
                "address": self.addresses["addr_2"],
                "company": self.companies["co_2"],
                "orders": [self.orders["o_2"]],
                "wishlist": [self.products["p_1"]],
                "reviews": [],
            },
            "u_3": {
                "id": "u_3",
                "name": "Katherine Johnson",
                "email": "katherine@example.com",
                "profile": {
                    "bio": "Orbital mechanics expert.",
                    "joinedAt": "2024-01-10T12:00:00Z",
                    "preferences": {
                        "newsletter": True,
                        "favoriteCategories": [self.categories["cat_3"]],
                    },
                },
                "address": self.addresses["addr_3"],
                "company": self.companies["co_1"],
                "orders": [],
                "wishlist": [self.products["p_3"], self.products["p_5"]],
                "reviews": [],
            },
        }

        self.reviews = {
            "r_1": {
                "id": "r_1",
                "rating": 5,
                "title": "Perfect for morning runs",
                "body": "Lightweight and supportive.",
                "author": self.user_store["u_1"],
                "product": self.products["p_1"],
                "createdAt": "2024-01-03T08:10:00Z",
            },
            "r_2": {
                "id": "r_2",
                "rating": 4,
                "title": "Solid build",
                "body": "Would buy again.",
                "author": self.user_store["u_2"],
                "product": self.products["p_1"],
                "createdAt": "2024-01-04T14:20:00Z",
            },
            "r_3": {
                "id": "r_3",
                "rating": 5,
                "title": "Great for rainy hikes",
                "body": "Kept me warm and dry.",
                "author": self.user_store["u_2"],
                "product": self.products["p_2"],
                "createdAt": "2024-01-07T10:00:00Z",
            },
            "r_4": {
                "id": "r_4",
                "rating": 3,
                "title": "Cute but small",
                "body": "Fits one cup.",
                "author": self.user_store["u_3"],
                "product": self.products["p_3"],
                "createdAt": "2024-01-12T09:15:00Z",
            },
        }

        for review in self.reviews.values():
            review["author"]["reviews"].append(review)
            review["product"]["reviews"].append(review)

        self.user_list = list(self.user_store.values())
        self.product_list = list(self.products.values())
        self.category_list = list(self.categories.values())

    @staticmethod
    def _normalize_id(value: str, prefix: str) -> str:
        if value.startswith(prefix):
            return value
        return f"{prefix}{value}"

    def user(self, info, id: str):
        return self.user_store.get(id) or self.user_store.get(self._normalize_id(id, "u_"))

    def users(self, info, limit: int = 10, offset: int = 0):
        start = max(0, int(offset or 0))
        end = start + max(0, int(limit or 0))
        return self.user_list[start:end]

    def order(self, info, id: str):
        return self.orders.get(id) or self.orders.get(self._normalize_id(id, "o_"))

    def orders(self, info, status: str | None = None, limit: int = 10):
        results = list(self.orders.values())
        if status:
            results = [order for order in results if order.get("status") == status]
        return results[: max(0, int(limit or 0))]

    def product(self, info, id: str):
        return self.products.get(id) or self.products.get(self._normalize_id(id, "p_"))

    def products(self, info, limit: int = 10, offset: int = 0):
        start = max(0, int(offset or 0))
        end = start + max(0, int(limit or 0))
        return self.product_list[start:end]

    def searchProducts(self, info, term: str, limit: int = 10):
        term_l = (term or "").lower()
        results = []
        for p in self.products.values():
            hay = " ".join(
                [
                    p.get("name") or "",
                    p.get("description") or "",
                    " ".join(p.get("tags") or []),
                    (p.get("category") or {}).get("name") or "",
                ]
            ).lower()
            if term_l in hay:
                results.append(p)
        return results[: max(0, int(limit or 0))]

    def category(self, info, id: str):
        return self.categories.get(id) or self.categories.get(self._normalize_id(id, "cat_"))

    def categories(self, info):
        return self.category_list

    def placeOrder(self, info, input):
        user_id = input.get("userId")
        items = input.get("items") or []
        normalized_user_id = self._normalize_id(user_id, "u_")
        if normalized_user_id not in self.user_store:
            raise ValueError(f"Unknown userId: {user_id}")
        if not items:
            raise ValueError("No items provided")
        order_items = []
        total = 0.0
        for item in items:
            product_id = self._normalize_id(item.get("productId", ""), "p_")
            product = self.products.get(product_id)
            if not product:
                raise ValueError(f"Unknown productId: {item.get('productId')}")
            quantity = int(item.get("quantity") or 0)
            if quantity <= 0:
                raise ValueError("Invalid quantity")
            subtotal = product["price"] * quantity
            order_items.append(
                {
                    "product": product,
                    "quantity": quantity,
                    "subtotal": subtotal,
                    "appliedDiscounts": [],
                }
            )
            total += subtotal

        discounts = []
        coupon = (input.get("couponCode") or "").upper()
        if coupon in self.discounts:
            discount = self.discounts[coupon]
            discounts.append(discount)
            total = max(0.0, total - float(discount.get("amount") or 0.0))

        note = input.get("note")
        order = {
            "id": "o_new",
            "status": "PENDING",
            "items": order_items,
            "total": round(total, 2),
            "placedAt": "2024-02-01T09:00:00Z",
            "shipment": None,
            "payment": None,
            "discounts": discounts,
            "notes": [note] if note else [],
        }
        return {
            "id": "oc_1",
            "estimatedDelivery": "2024-01-10",
            "message": input.get("note") or "Order placed",
            "order": order,
        }


def _format_result(result) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if result.data is not None:
        payload["data"] = result.data
    if result.errors:
        formatted = []
        for err in result.errors:
            try:
                formatted.append(err.formatted)  # type: ignore[attr-defined]
            except Exception:
                formatted.append({"message": str(err)})
        payload["errors"] = formatted
    return payload


def make_handler(schema_sdl: str):
    schema = build_schema(schema_sdl)
    root = Root()

    class Handler(BaseHTTPRequestHandler):
        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "content-type, authorization")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.end_headers()

        def do_GET(self):
            if self.path == "/healthz":
                _json_response(self, 200, {"ok": True})
                return
            _json_response(self, 404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/graphql":
                _json_response(self, 404, {"error": "not found"})
                return
            try:
                body = _read_json(self)
                query = body.get("query")
                variables = body.get("variables") or {}
                operation_name = body.get("operationName")
                if not query:
                    _json_response(self, 400, {"error": "Missing 'query' in JSON body"})
                    return
                result = graphql_sync(
                    schema,
                    query,
                    variable_values=variables,
                    operation_name=operation_name,
                    root_value=root,
                )
                payload = _format_result(result)
                status = 200 if not result.errors else 400
                _json_response(self, status, payload)
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})

        def log_message(self, format, *args):
            return

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(description="Minimal GraphQL HTTP server for local testing.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4000)
    parser.add_argument(
        "--schema",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "schema.graphql",
        help="Path to schema SDL (default: ../schema.graphql).",
    )
    args = parser.parse_args()

    schema_sdl = args.schema.read_text()
    handler = make_handler(schema_sdl)
    httpd = HTTPServer((args.host, args.port), handler)
    print(f"Test GraphQL server running at http://{args.host}:{args.port}/graphql", flush=True)
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
