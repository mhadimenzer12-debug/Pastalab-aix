const ORIGIN = "https://pastalab-aix.com";

const PRODUCTS = {
  "bolognaise-pates": ["Bolognaise — Pâtes", 12.50],
  "bolognaise-gnocchis": ["Bolognaise — Gnocchis", 12.90],
  "carbonara-pates": ["Carbonara — Pâtes", 12.50],
  "carbonara-gnocchis": ["Carbonara — Gnocchis", 13.50],
  "gorgonzola-pates": ["Gorgonzola — Pâtes", 12.90],
  "gorgonzola-gnocchis": ["Gorgonzola — Gnocchis", 13.50],
  "pesto-pates": ["Pesto tomates cerises & pignons — Pâtes", 12.90],
  "pesto-gnocchis": ["Pesto tomates cerises & pignons — Gnocchis", 13.50],
  "arrabbiata-pates": ["Arrabbiata — Pâtes", 11.50],
  "arrabbiata-gnocchis": ["Arrabbiata — Gnocchis", 12.90],
  "truffe-pates": ["Crème de truffe — Pâtes", 14.90],
  "truffe-gnocchis": ["Crème de truffe — Gnocchis", 15.50],

  "parmesan": ["Supplément Parmesan", 2.00],
  "burrata": ["Supplément Burrata", 3.50],
  "boeuf": ["Supplément Bœuf haché", 2.50],
  "poulet": ["Supplément Poulet", 2.50],
  "parme": ["Supplément Jambon de Parme", 3.50],
  "truffe-fraiche": ["Supplément Truffe fraîche", 3.90],

  "tiramisu": ["Tiramisu", 4.90],
  "panna-cotta": ["Panna cotta", 4.50],
  "franui": ["Franui", 5.90],
  "moelleux": ["Moelleux chocolat", 4.50],

  "coca": ["Coca-Cola", 2.50],
  "coca-zero": ["Coca-Cola Zéro", 2.50],
  "oasis": ["Oasis", 2.50],
  "ice-tea": ["Ice Tea", 2.50],
  "cristalline": ["Cristalline", 1.50],
  "red-bull": ["Red Bull", 3.50],
  "san-pellegrino": ["San Pellegrino", 2.50],
  "limonata": ["Limonata", 3.00],
  "aranciata": ["Aranciata", 3.00],
  "chinotto": ["Chinotto", 3.50],

  "pause-italienne": ["La Pause Italienne", 13.90],
  "dolce-vita": ["La Dolce Vita", 18.90],
  "in-due": ["In Due", 27.90],
  "famiglia": ["La Famiglia", 45.90],
  "grande-famiglia": ["La Grande Famiglia", 54.90]
};

function headers() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: headers()
  });
}

export default {
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: headers()
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return reply({
        ok: true,
        service: "PASTA LAB Paiement"
      });
    }

    if (request.method !== "POST" || url.pathname !== "/create-payment") {
      return reply({ error: "Route inconnue" }, 404);
    }

    if (!env.MOLLIE_API_KEY) {
      return reply({ error: "Clé Mollie absente" }, 500);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return reply({ error: "Commande invalide" }, 400);
    }

    const cart = Array.isArray(body.cart) ? body.cart : [];

    if (!cart.length) {
      return reply({ error: "Panier vide" }, 400);
    }

    let subtotal = 0;
    const items = [];

    for (const line of cart) {
      const product = PRODUCTS[line.id];
      const qty = Number(line.qty);

      if (!product || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return reply({ error: "Article invalide" }, 400);
      }

      subtotal += Math.round(product[1] * 100) * qty;
      items.push(`${qty}x ${product[0]}`);
    }

    const delivery = body.delivery || "retrait";

    let deliveryFee = 0;

    if (delivery === "0-5") {
      if (subtotal < 2000) {
        return reply({ error: "Minimum 20 € pour cette zone" }, 400);
      }

      deliveryFee = subtotal >= 4500 ? 0 : 390;
    }

    else if (delivery === "5-8") {
      if (subtotal < 3000) {
        return reply({ error: "Minimum 30 € pour cette zone" }, 400);
      }

      deliveryFee = 590;
    }

    else if (delivery === "8-12") {
      if (subtotal < 4000) {
        return reply({ error: "Minimum 40 € pour cette zone" }, 400);
      }

      deliveryFee = 790;
    }

    else if (delivery !== "retrait") {
      return reply({ error: "Livraison invalide" }, 400);
    }

    const total = subtotal + deliveryFee;

    const orderId =
      "PL-" + Date.now().toString(36).toUpperCase();

    const customer = {
      name: String(body.customer?.name || "").slice(0, 80),
      phone: String(body.customer?.phone || "").slice(0, 40),
      email: String(body.customer?.email || "").slice(0, 120),
      address: String(body.customer?.address || "").slice(0, 180)
    };

    const payment = {
      amount: {
        currency: "EUR",
        value: (total / 100).toFixed(2)
      },

      description: `PASTA LAB ${orderId}`,

      redirectUrl:
        `https://pastalab-aix.com/?paiement=retour&commande=${orderId}`,

      metadata: {
        orderId,
        customer,
        items,
        delivery,
        total: (total / 100).toFixed(2)
      }
    };

    const mollieResponse = await fetch(
      "https://api.mollie.com/v2/payments",
      {
        method: "POST",

        headers: {
          "Authorization": `Bearer ${env.MOLLIE_API_KEY}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify(payment)
      }
    );

    const result = await mollieResponse.json();

    if (!mollieResponse.ok) {
      return reply({
        error: "Erreur Mollie"
      }, 502);
    }

    const checkoutUrl =
      result?._links?.checkout?.href;

    if (!checkoutUrl) {
      return reply({
        error: "Lien Mollie introuvable"
      }, 502);
    }

    return reply({
      ok: true,
      orderId,
      total: (total / 100).toFixed(2),
      checkoutUrl
    });
  }
};
