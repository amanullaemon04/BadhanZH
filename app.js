/* =========================================================
   HALL BLOOD DONOR
   Public Donor Directory
   ========================================================= */

(() => {
  "use strict";

  // ---------------------------------------------------------
  // Elements
  // ---------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const bloodEl = $("blood");
  const cityEl = $("city");
  const locationEl = $("location");
  const statusEl = $("status");
  const sortEl = $("sort");
  const resultsEl = $("results");
  const countEl = $("count");


  // ---------------------------------------------------------
  // Safe text
  // ---------------------------------------------------------

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }


  // ---------------------------------------------------------
  // Normalization
  // ---------------------------------------------------------

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/\u00A0/g, " ")
      .replace(/\u200B/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }


  function textMatches(searchValue, donorValue) {
    const search = normalize(searchValue);
    const donor = normalize(donorValue);

    if (!search) return true;
    if (!donor) return false;

    return donor.includes(search);
  }


  // ---------------------------------------------------------
  // Date handling
  // ---------------------------------------------------------

  function parseDate(value) {
    if (!value) return null;

    if (value instanceof Date) {
      const d = new Date(value.getTime());
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const raw = String(value).trim();

    if (!raw) return null;


    // Supabase DATE:
    // YYYY-MM-DD
    const isoDate = raw.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    );

    if (isoDate) {
      const d = new Date(
        Date.UTC(
          Number(isoDate[1]),
          Number(isoDate[2]) - 1,
          Number(isoDate[3])
        )
      );

      return Number.isNaN(d.getTime()) ? null : d;
    }


    // YYYY-MM-DD with time
    const isoDateTime = raw.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})[T\s]/
    );

    if (isoDateTime) {
      const d = new Date(raw);

      return Number.isNaN(d.getTime()) ? null : d;
    }


    // MM/DD/YYYY
    const slashDate = raw.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );

    if (slashDate) {
      const d = new Date(
        Date.UTC(
          Number(slashDate[3]),
          Number(slashDate[1]) - 1,
          Number(slashDate[2])
        )
      );

      return Number.isNaN(d.getTime()) ? null : d;
    }


    // General fallback
    const d = new Date(raw);

    return Number.isNaN(d.getTime()) ? null : d;
  }


  function formatDate(value) {
    const d = parseDate(value);

    if (!d) {
      return "Not specified";
    }

    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    });
  }


  // ---------------------------------------------------------
  // Donation eligibility
  //
  // Rule:
  // Last donation + 3 calendar months = next eligible date
  // ---------------------------------------------------------

  function eligibilityDate(lastDonation) {
    const d = parseDate(lastDonation);

    if (!d) {
      return null;
    }

    return new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth() + 3,
        d.getUTCDate()
      )
    );
  }


  function todayUTC() {
    const now = new Date();

    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      )
    );
  }


  // ---------------------------------------------------------
  // Determine donor availability
  //
  // If last_donation exists:
  //     last donation + 3 months determines availability.
  //
  // If no last_donation exists:
  //     use admin's available field.
  // ---------------------------------------------------------

  function effectiveAvailable(donor) {
    const lastDonation = donor.last_donation;

    if (lastDonation) {
      const eligible = eligibilityDate(lastDonation);

      if (eligible) {
        return eligible.getTime() <= todayUTC().getTime();
      }
    }

    return donor.available === true ||
           donor.available === "true" ||
           donor.available === 1 ||
           donor.available === "1";
  }


  function effectiveAvailableDate(donor) {
    if (donor.last_donation) {
      const eligible = eligibilityDate(
        donor.last_donation
      );

      if (eligible) {
        return eligible;
      }
    }

    if (donor.available_from) {
      return parseDate(donor.available_from);
    }

    return null;
  }


  // ---------------------------------------------------------
  // Supabase configuration
  // ---------------------------------------------------------

  function getConfigValue(names) {
    for (const name of names) {
      if (
        typeof window[name] !== "undefined" &&
        window[name]
      ) {
        return window[name];
      }
    }

    return "";
  }


  function createClient() {
    if (
      !window.supabase ||
      typeof window.supabase.createClient !== "function"
    ) {
      throw new Error(
        "Supabase library could not be loaded."
      );
    }


    const url = getConfigValue([
      "SUPABASE_URL",
      "supabaseUrl",
      "SUPABASE_PROJECT_URL",
      "PROJECT_URL"
    ]);


    const key = getConfigValue([
      "SUPABASE_ANON_KEY",
      "SUPABASE_KEY",
      "supabaseAnonKey",
      "ANON_KEY",
      "PUBLIC_SUPABASE_ANON_KEY"
    ]);


    if (!url || !key) {
      throw new Error(
        "Supabase configuration was not found. Check config.js."
      );
    }


    return window.supabase.createClient(
      url,
      key
    );
  }


  let supabaseClient = null;

  let allDonors = [];


  // ---------------------------------------------------------
  // Load donors
  // ---------------------------------------------------------

  async function loadDonors() {
    try {

      if (!supabaseClient) {
        supabaseClient = createClient();
      }


      const {
        data,
        error
      } = await supabaseClient
        .from("donors")
        .select("*");


      if (error) {
        throw error;
      }


      allDonors = Array.isArray(data)
        ? data
        : [];


      /*
        IMPORTANT:
        Do NOT rebuild the district dropdown here.

        The 64 Bangladesh districts are already written
        inside index.html.
      */

      render();

    } catch (error) {

      console.error(
        "Could not load donors:",
        error
      );


      if (countEl) {
        countEl.textContent = "0 donors";
      }


      if (resultsEl) {
        resultsEl.innerHTML = `
          <div class="empty-state">
            <strong>Could not load donors.</strong>
            <p>Please refresh the page and try again.</p>
          </div>
        `;
      }
    }
  }


  // ---------------------------------------------------------
  // City / District
  //
  // DO NOT replace the 64 districts in index.html.
  // ---------------------------------------------------------

  function populateCities() {

    if (!cityEl) {
      return;
    }

    /*
      The district list is controlled by index.html.

      Therefore this function intentionally does nothing.
    */

  }


  // ---------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------

  function filteredDonors() {

    const blood = normalize(
      bloodEl?.value
    );

    const city = normalize(
      cityEl?.value
    );

    const location = normalize(
      locationEl?.value
    );

    const status = normalize(
      statusEl?.value
    );


    /*
      City / District is required.

      "All districts" means no district has been selected,
      so we don't show donors yet.

      This prevents simply selecting B+ from showing
      donors from every part of Bangladesh.
    */

    if (!city) {
      return [];
    }


    const list = allDonors.filter((donor) => {

      const donorBlood = normalize(
        donor.blood_group ??
        donor.blood
      );


      const donorCity = normalize(
        donor.city
      );


      const donorLocation = normalize(
        donor.location
      );


      // -----------------------------------------------------
      // Blood group
      // -----------------------------------------------------

      if (
        blood &&
        donorBlood !== blood
      ) {
        return false;
      }


      // -----------------------------------------------------
      // City / District
      //
      // Exact district matching.
      // -----------------------------------------------------

      if (
        donorCity !== city
      ) {
        return false;
      }


      // -----------------------------------------------------
      // Specific location
      //
      // Optional.
      //
      // Example:
      // Dhaka = all Dhaka donors
      //
      // Dhaka + Zahurul Huq Hall =
      // only Zahurul Huq Hall donors
      // -----------------------------------------------------

      if (
        location &&
        !textMatches(
          location,
          donorLocation
        )
      ) {
        return false;
      }


      // -----------------------------------------------------
      // Availability
      // -----------------------------------------------------

      const available =
        effectiveAvailable(donor);


      if (
        status === "available" &&
        !available
      ) {
        return false;
      }


      if (
        status === "unavailable" &&
        available
      ) {
        return false;
      }


      return true;
    });


    // -------------------------------------------------------
    // Sorting
    // -------------------------------------------------------

    const sort =
      sortEl?.value ||
      "available";


    // Available first
    if (sort === "available") {

      list.sort((a, b) => {

        const av =
          effectiveAvailable(a)
            ? 0
            : 1;

        const bv =
          effectiveAvailable(b)
            ? 0
            : 1;


        if (av !== bv) {
          return av - bv;
        }


        return normalize(
          a.name
        ).localeCompare(
          normalize(b.name)
        );
      });
    }


    // Blood group
    else if (sort === "blood") {

      list.sort((a, b) => {

        return normalize(
          a.blood_group ??
          a.blood
        ).localeCompare(
          normalize(
            b.blood_group ??
            b.blood
          )
        );
      });
    }


    // Location
    else if (sort === "location") {

      list.sort((a, b) => {

        const al =
          `${a.city ?? ""} ${a.location ?? ""}`;

        const bl =
          `${b.city ?? ""} ${b.location ?? ""}`;


        return al.localeCompare(bl);
      });
    }


    // Recently verified
    else if (sort === "recent") {

      list.sort((a, b) => {

        const ad =
          parseDate(
            a.verified_at
          )?.getTime() || 0;


        const bd =
          parseDate(
            b.verified_at
          )?.getTime() || 0;


        return bd - ad;
      });
    }


    return list;
  }


  // ---------------------------------------------------------
  // Donor card
  // ---------------------------------------------------------

  function donorCard(donor) {

    const name = escapeHtml(
      donor.name ||
      "Unnamed donor"
    );


    const blood = escapeHtml(
      donor.blood_group ??
      donor.blood ??
      "—"
    );


    const city = escapeHtml(
      donor.city ||
      "—"
    );


    const location = escapeHtml(
      donor.location ||
      "Not specified"
    );


    const available =
      effectiveAvailable(donor);


    const statusClass =
      available
        ? "available"
        : "unavailable";


    const statusText =
      available
        ? "Available"
        : "Unavailable";


    const lastDonation =
      formatDate(
        donor.last_donation
      );


    const availableFrom =
      formatDate(
        effectiveAvailableDate(donor)
      );


    const verified =
      formatDate(
        donor.verified_at
      );


    const phone =
      String(
        donor.phone ?? ""
      ).trim();


    const contactButton =
      phone
        ? `
          <a
            class="contact-btn"
            href="tel:${escapeHtml(phone)}"
          >
            Contact donor
          </a>
        `
        : `
          <button
            class="contact-btn"
            type="button"
            disabled
          >
            Contact donor
          </button>
        `;


    return `
      <article class="donor-card">

        <div class="donor-card-head">

          <h3>
            ${name}
          </h3>

          <strong class="blood-badge">
            ${blood}
          </strong>

        </div>


        <span class="status ${statusClass}">
          ${statusText}
        </span>


        <div class="donor-location">
          📍 ${city} • ${location}
        </div>


        <div class="donor-date">
          🩸 Last donation:
          ${lastDonation}
        </div>


        <div class="donor-available">
          📅 Available from:
          ${availableFrom}
        </div>


        <div class="donor-verified">
          🛡️ Verified:
          ${verified}
        </div>


        ${contactButton}

      </article>
    `;
  }


  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------

  function render() {

    if (!resultsEl) {
      return;
    }


    const donors =
      filteredDonors();


    if (countEl) {

      countEl.textContent =
        `${donors.length} ${
          donors.length === 1
            ? "donor"
            : "donors"
        }`;
    }


    // No district selected
    if (!normalize(cityEl?.value)) {

      resultsEl.innerHTML = `
        <div class="empty-state">
          <strong>Select a district first.</strong>
          <p>
            Choose a City / District to find blood donors.
          </p>
        </div>
      `;

      return;
    }


    // District selected but no donor
    if (!donors.length) {

      resultsEl.innerHTML = `
        <div class="empty-state">
          <strong>No donors found.</strong>
          <p>
            Try another blood group,
            location, or availability filter.
          </p>
        </div>
      `;

      return;
    }


    // Donors found
    resultsEl.innerHTML =
      donors
        .map(donorCard)
        .join("");
  }


  // ---------------------------------------------------------
  // Events
  // ---------------------------------------------------------

  [
    bloodEl,
    cityEl,
    locationEl,
    statusEl,
    sortEl
  ].forEach((element) => {

    if (!element) {
      return;
    }


    element.addEventListener(
      "input",
      render
    );


    element.addEventListener(
      "change",
      render
    );

  });


  // ---------------------------------------------------------
  // Initial render
  // ---------------------------------------------------------

  render();


  // ---------------------------------------------------------
  // Load Supabase data
  // ---------------------------------------------------------

  loadDonors();

})();
