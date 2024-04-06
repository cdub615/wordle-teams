alter table public.webhook_events
add webhook_id uuid;

CREATE OR REPLACE FUNCTION public.process_event_on_insert()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  data json;
  payload json;
  webhook_url text;
  webhook_secret text;
  webhook_response text;
BEGIN
  select decrypted_secret into webhook_url from vault.decrypted_secrets where name = 'WT_WEBHOOK_URL';
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'SUPABASE_WEBHOOK_SECRET';

  -- Construct the JSON data to send to the webhook
  data = json_build_object(
    'webhookId', NEW.webhook_id
  );

  -- Add custom headers to the payload
  payload = json_build_object(
    'headers', json_build_object(
      'Content-Type', 'application/json',
      'X-Signature', decrypted_secret
    ),
    'body', data
  );

  -- Send the HTTP request to your webhook URL
  BEGIN
    SELECT http_call_json(
      webhook_url,
      'POST',
      payload::text
    )
    INTO webhook_response;

    RAISE NOTICE 'Webhook response: %', webhook_response;
  EXCEPTION
    WHEN OTHERS THEN
      -- Log the error
      RAISE NOTICE 'Error sending webhook: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;