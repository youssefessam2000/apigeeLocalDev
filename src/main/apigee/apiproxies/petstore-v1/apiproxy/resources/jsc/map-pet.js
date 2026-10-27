// Mapping: keeps only id, name and status from the Petstore pet object.
// The result goes to envelope.data; the common-envelope shared flow wraps it as {header, data}.
// id comes from EV-ExtractPet as text: Petstore IDs are int64 and a JavaScript number
// would round values above 2^53.
var pet = JSON.parse(context.getVariable("response.content"));
var id = context.getVariable("pet.id");
if (!/^-?[0-9]+$/.test(id || "")) {
  id = "null";
}
context.setVariable("envelope.data",
  "{\"id\":" + id +
  ",\"name\":" + JSON.stringify(pet.name === undefined ? null : pet.name) +
  ",\"status\":" + JSON.stringify(pet.status === undefined ? null : pet.status) + "}");
