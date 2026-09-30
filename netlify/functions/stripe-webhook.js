const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://ybkpefhrmxbwoygzxvsm.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Verify the webhook came from Stripe
  let stripeEvent;
  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const sig = event.headers["stripe-signature"];
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Handle successful subscription payment
  if (
    stripeEvent.type === "customer.subscription.created" ||
    stripeEvent.type === "invoice.payment_succeeded"
  ) {
    const subscription = stripeEvent.data.object;
    const customerId = subscription.customer;

    try {
      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
      const customer = await stripe.customers.retrieve(customerId);
      const email = customer.email;

      if (!email) {
        console.error("No email found for customer:", customerId);
        return { statusCode: 200, body: "No email found" };
      }

      // Update the user in Supabase
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data: users, error: fetchError } = await sb.auth.admin.listUsers();

      if (fetchError) {
        console.error("Error fetching users:", fetchError);
        return { statusCode: 500, body: "Error fetching users" };
      }

      const user = users.users.find((u) => u.email === email);

      if (!user) {
        console.error("No Supabase user found for email:", email);
        return { statusCode: 200, body: "User not found" };
      }

      const { error: updateError } = await sb.auth.admin.updateUserById(
        user.id,
        { user_metadata: { ...user.user_metadata, subscribed: true } }
      );

      if (updateError) {
        console.error("Error updating user:", updateError);
        return { statusCode: 500, body: "Error updating user" };
      }

      console.log("Successfully marked user as subscribed:", email);
      return { statusCode: 200, body: "Success" };
    } catch (err) {
      console.error("Error processing webhook:", err);
      return { statusCode: 500, body: "Internal error" };
    }
  }

  // Handle subscription cancellation
  if (stripeEvent.type === "customer.subscription.deleted") {
    const subscription = stripeEvent.data.object;
    const customerId = subscription.customer;

    try {
      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
      const customer = await stripe.customers.retrieve(customerId);
      const email = customer.email;

      if (email) {
        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: users } = await sb.auth.admin.listUsers();
        const user = users.users.find((u) => u.email === email);

        if (user) {
          await sb.auth.admin.updateUserById(user.id, {
            user_metadata: { ...user.user_metadata, subscribed: false },
          });
          console.log("Marked user as unsubscribed:", email);
        }
      }
    } catch (err) {
      console.error("Error handling cancellation:", err);
    }
  }

  return { statusCode: 200, body: "Event received" };
};
