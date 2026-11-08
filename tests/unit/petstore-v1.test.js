"use strict";

const { expect } = require("chai");
const { runPolicy } = require("./helpers/apigee");

describe("petstore-v1", function () {
  // JS-MapPet: ResourceURL map-pet.js, no IncludeURL.
  describe("map-pet.js", function () {
    function mapPet(pet, petId) {
      const vars = runPolicy("petstore", ["map-pet.js"], {
        "response.content": typeof pet === "string" ? pet : JSON.stringify(pet),
        "pet.id": petId
      });
      return vars["envelope.data"];
    }

    it("keeps only id, name and status", function () {
      const data = mapPet(
        { id: 10, name: "doggie", status: "available", category: { id: 1 }, photoUrls: [], tags: [] },
        "10");
      expect(JSON.parse(data)).to.deep.equal({ id: 10, name: "doggie", status: "available" });
    });

    it("writes the int64 id as text so it is not rounded", function () {
      const data = mapPet({ id: 9223372036854775807, name: "big" }, "9223372036854775807");
      expect(data).to.contain("\"id\":9223372036854775807,");
    });

    it("accepts a negative id", function () {
      expect(mapPet({ name: "x" }, "-5")).to.contain("\"id\":-5,");
    });

    it("writes null for a missing or non-numeric id", function () {
      [null, "", "abc", "1.5", "1e3", "10; drop"].forEach(function (id) {
        expect(JSON.parse(mapPet({ name: "x" }, id)).id, JSON.stringify(id)).to.equal(null);
      });
    });

    it("writes null for a missing name or status", function () {
      expect(JSON.parse(mapPet({}, "1"))).to.deep.equal({ id: 1, name: null, status: null });
    });

    it("escapes quotes in name and status", function () {
      const data = mapPet({ name: "a \"quoted\" name", status: "sold\n" }, "1");
      expect(JSON.parse(data)).to.deep.equal({ id: 1, name: "a \"quoted\" name", status: "sold\n" });
    });

    it("keeps a name that is not a string as its JSON value", function () {
      expect(JSON.parse(mapPet({ name: 42, status: false }, "1"))).to.deep.equal(
        { id: 1, name: 42, status: false });
    });

    it("throws when the backend body is not JSON, so the policy raises a fault", function () {
      // The error comes from the vm sandbox, so it is matched by name, not by class.
      expect(function () { mapPet("<html>oops</html>", "1"); }).to.throw().with.property("name", "SyntaxError");
    });
  });
});
