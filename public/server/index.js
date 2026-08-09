export default {
  async fetch(request, environment) {
    if (!environment.ASSETS) {
      return new Response("Static asset binding unavailable.", { status: 500 });
    }
    return environment.ASSETS.fetch(request);
  },
};
