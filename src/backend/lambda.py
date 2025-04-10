from flask import Flask, request, jsonify
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger()

app = Flask(__name__)

@app.route('/analyze', methods=['POST'])
def analyze_text():
    """Receives text via POST request and returns a dummy analysis."""
    logger.info("Received request at /analyze")
    try:
        data = request.get_json()
        if not data or 'text' not in data:
            logger.error("Invalid request body: missing 'text' field")
            return jsonify({"error": "Missing 'text' field in request body"}), 400

        text_to_analyze = data['text']
        logger.info(f"Text received for analysis: {text_to_analyze[:100]}...") # Log first 100 chars

        # --- TODO: Replace with actual Anthropic API call --- 
        dummy_interpretation = f"Backend received: {text_to_analyze}"
        dummy_preview = f"Preview would show: {text_to_analyze}"
        dummy_suggestion = f"Suggestion based on: {text_to_analyze}"
        # --- End TODO ---

        response_data = {
            "interpretation": dummy_interpretation,
            "preview": dummy_preview,
            "suggestion": dummy_suggestion
        }

        logger.info("Returning dummy analysis")
        return jsonify(response_data), 200

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

# --- AWS Lambda Handler --- 
# This part makes the Flask app compatible with AWS Lambda & API Gateway
# You might need to adjust this depending on your exact Lambda setup 
# (e.g., using frameworks like Chalice or Serverless Framework might change this)
# If using standard Lambda with API Gateway Proxy Integration:

def lambda_handler(event, context):
    """AWS Lambda entry point that wraps the Flask app."""
    # You might need a library like 'awsgi' or 'serverless-wsgi' 
    # to handle the conversion from Lambda event to WSGI request
    # for a full Flask app.
    # For this simple case, we can directly call the view function if 
    # the API Gateway payload is simple and matches the /analyze route.
    
    logger.info(f"Lambda event received: {event}")

    # Basic routing assumption for simple proxy integration
    if event.get('path') == '/analyze' and event.get('httpMethod') == 'POST':
        # Simulate a Flask request context - THIS IS A SIMPLIFICATION!
        # Real-world use often requires a WSGI adapter.
        try:
            # Extract body assuming API Gateway proxy integration format
            body_str = event.get('body', '{}')
            if not isinstance(body_str, str):
                 logger.warning("Event body is not a string, attempting decode or direct use.")
                 # Attempt to handle potential non-string body scenarios
                 try:
                     body_str = body_str.decode('utf-8') if hasattr(body_str, 'decode') else str(body_str)
                 except Exception as decode_err:
                     logger.error(f"Failed to decode/convert body: {decode_err}")
                     body_str = '{}' # Fallback to empty JSON string

            with app.test_request_context(path='/analyze', method='POST', data=body_str, content_type='application/json'):
                # Manually parse JSON from the body string for Flask's request object
                request.json = request.get_json(force=True, silent=True)
                if request.json is None:
                     logger.error("Failed to parse JSON from event body string")
                     return {'statusCode': 400, 'body': '{"error": "Invalid JSON in request body"}'}

                # Call the view function
                response = app.full_dispatch_request()
            
            # Format the Flask response for API Gateway
            return {
                'statusCode': response.status_code,
                'headers': dict(response.headers),
                'body': response.get_data(as_text=True)
            }
        except Exception as e:
             logger.error(f"Error invoking Flask route via Lambda: {str(e)}", exc_info=True)
             return {'statusCode': 500, 'body': '{"error": "Internal server error during Lambda execution"}'}
    else:
        logger.warning(f"Unhandled path/method: {event.get('path')} {event.get('httpMethod')}")
        return {
            'statusCode': 404,
            'body': '{"error": "Not Found"}'
        }

# If running locally for testing (e.g., `python lambda.py`)
if __name__ == '__main__':
    app.run(debug=True, port=5000)
