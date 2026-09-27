/* =========================================================
   BADHAN ZH - Public Donor Directory
   Robust filtering + automatic availability calculation
   ========================================================= */

(() => {
  "use strict";

  // ---------------------------------------------------------
  // DOM
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
  // Global data
  // ---------------------------------------------------------

  let supabaseClient = null;
  let allDonors = [];

  // ---------------------------------------------------------
  // TEXT NORMALIZATION
  // ---------------------------------------------------------
  // Makes:
  // Zahurul Huq Hall
  // zahurul huq hall
  // ZAHURUL HUQ HALL
  // Zahurul   Huq   Hall
  //
  // all behave the same.
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

  function cleanText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/\u00A0/g, " ")
      .replace(/\u200B/g, "")
      .trim()
      .replace(/\s+/g, " ");
  }

  // ---------------------------------------------------------
  // HTML SAFETY
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
  // DATE FUNCTIONS
  // ---------------------------------------------------------

  function parseDate(value) {
    if (!value) return null;

    if (value instanceof Date) {
      const d = new Date(value.getTime());
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const raw = String(value).trim();

    if (!raw) return null;

    // YYYY-MM-DD
    const iso = raw.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})/
    );

    if (iso) {
      const d = new Date(
        Date.UTC(
          Number(iso[1]),
          Number(iso[2]) - 1,
          Number(iso[3])
        )
      );

      return Number.isNaN(d.getTime()) ? null : d;
    }

    // MM/DD/YYYY
    const slash = raw.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );

    if (slash) {
      const d = new Date(
        Date.UTC(
          Number(slash[3]),
          Number(slash[1]) - 1,
          Number(slash[2])
        )
      );

      return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(raw);

    return Number.isNaN(d.getTime()) ? null : d;
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
  // ELIGIBILITY
  // ---------------------------------------------------------
  // Blood donation eligibility:
  // last donation + 3 calendar months
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

  // ---------------------------------------------------------
  // DONOR FIELD HELPERS
  // ---------------------------------------------------------
  // Supports common schema column variations.
  // ---------------------------------------------------------

  function getBlood(donor) {
    return (
      donor.blood_group ??
      donor.blood ??
      donor.bloodGroup ??
      ""
    );
  }

  function getCity(donor) {
    return (
      donor.city ??
      donor.district ??
      donor.city_district ??
      ""
    );
  }

  function getLocation(donor) {
    return (
      donor.location ??
      donor.donation_location ??
      donor.hall ??
      donor.hall_name ??
      donor.specific_location ??
      ""
    );
  }

  function getName(donor) {
    return (
      donor.name ??
      donor.full_name ??
      donor.fullName ??
      "Unnamed donor"
    );
  }

  function getPhone(donor) {
    return (
      donor.phone ??
      donor.mobile ??
      donor.phone_number ??
      ""
    );
  }

  function getLastDonation(donor) {
    return (
      donor.last_donation ??
      donor.lastDonation ??
      donor.last_donation_date ??
      ""
    );
  }

  function getVerifiedAt(donor) {
    return (
      donor.verified_at ??
      donor.verifiedAt ??
      donor.verified_date ??
      ""
    );
  }

  function getAvailableFrom(donor) {
    return (
      donor.available_from ??
      donor.availableFrom ??
      ""
    );
  }

  // ---------------------------------------------------------
  // AVAILABILITY
  // ---------------------------------------------------------
  //
  // IMPORTANT:
  //
  // If last_donation exists:
  //     availability = last donation + 3 months
  //
  // This is authoritative.
  //
  // If last_donation does not exist:
  //     use database "available" field.
  // ---------------------------------------------------------

  function effectiveAvailable(donor) {
    const lastDonation = getLastDonation(donor);

    if (lastDonation) {
      const eligibleDate = eligibilityDate(lastDonation);

      if (eligibleDate) {
        return eligibleDate.getTime() <=
          todayUTC().getTime();
      }
    }

    // Fallback to database availability
    const value =
      donor.available ??
      donor.is_available ??
      donor.isAvailable ??
      donor.availability;

    if (typeof value === "boolean") {
      return value;
    }

    const normalized = normalize(value);

    if (
      normalized === "true" ||
      normalized === "yes" ||
      normalized === "available" ||
      normalized === "1"
    ) {
      return true;
    }

    if (
      normalized === "false" ||
      normalized === "no" ||
      normalized === "unavailable" ||
      normalized === "0"
    ) {
      return false;
    }

    return false;
  }

  function effectiveAvailableDate(donor) {
    const lastDonation = getLastDonation(donor);

    if (lastDonation) {
      const eligible = eligibilityDate(lastDonation);

      if (eligible) {
        return eligible;
      }
    }

    const availableFrom = getAvailableFrom(donor);

    if (availableFrom) {
      return parseDate(availableFrom);
    }

    return null;
  }

  // ---------------------------------------------------------
  // SUPABASE CONFIG
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

    return window.supabase.createClient(url, key);
  }

  // ---------------------------------------------------------
  // LOAD DONORS
  // ---------------------------------------------------------

  async function loadDonors() {
    try {
      if (!supabaseClient) {
        supabaseClient = createClient();
      }

      const { data, error } = await supabaseClient
        .from("donors")
        .select("*");

      if (error) {
        throw error;
      }

      allDonors = Array.isArray(data)
        ? data
        : [];

      populateCities();

      render();

    } catch (error) {
      console.error(
        "Could not load donors:",
        error
      );

      allDonors = [];

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
  // CITY DROPDOWN
  // ---------------------------------------------------------
  //
  // IMPORTANT:
  // We do NOT require location to be filled.
  //
  // City alone works perfectly.
  //
  // The dropdown is populated from donor data.
  // ---------------------------------------------------------

  function populateCities() {
    if (!cityEl) {
      return;
    }

    const currentValue =
      cleanText(cityEl.value);

    const cityMap = new Map();

    allDonors.forEach((donor) => {
      const city = cleanText(getCity(donor));

      if (!city) {
        return;
      }

      const key = normalize(city);

      if (!cityMap.has(key)) {
        cityMap.set(key, city);
      }
    });

    const cities = Array.from(
      cityMap.values()
    ).sort((a, b) =>
      a.localeCompare(b)
    );

    cityEl.innerHTML = "";

    const allOption =
      document.createElement("option");

    allOption.value = "";
    allOption.textContent = "All locations";

    cityEl.appendChild(allOption);

    cities.forEach((city) => {
      const option =
        document.createElement("option");

      option.value = city;
      option.textContent = city;

      cityEl.appendChild(option);
    });

    // Restore selected city
    const wanted = normalize(currentValue);

    if (wanted) {
      const matching = Array.from(
        cityEl.options
      ).find(
        (option) =>
          normalize(option.value) === wanted
      );

      if (matching) {
        cityEl.value = matching.value;
      }
    }
  }

  // ---------------------------------------------------------
  // LOCATION MATCH
  // ---------------------------------------------------------
  //
  // Specific location is OPTIONAL.
  //
  // Empty location:
  //     do NOT filter by location.
  //
  // Filled location:
  //     filter inside selected city.
  //
  // Case-insensitive + space-insensitive.
  // ---------------------------------------------------------

  function locationMatches(
    searchLocation,
    donorLocation
  ) {
    const search = normalize(searchLocation);
    const donor = normalize(donorLocation);

    if (!search) {
      return true;
    }

    if (!donor) {
      return false;
    }

    return donor.includes(search);
  }

  // ---------------------------------------------------------
  // FILTER DONORS
  // ---------------------------------------------------------

  function filteredDonors() {
    const blood =
      normalize(bloodEl?.value);

    const city =
      normalize(cityEl?.value);

    const location =
      normalize(locationEl?.value);

    const status =
      normalize(statusEl?.value);

    const list =
      allDonors.filter((donor) => {

        // -----------------------------------------------
        // BLOOD GROUP
        // -----------------------------------------------

        const donorBlood =
          normalize(getBlood(donor));

        if (
          blood &&
          donorBlood !== blood
        ) {
          return false;
        }

        // -----------------------------------------------
        // CITY / DISTRICT
        // -----------------------------------------------

        const donorCity =
          normalize(getCity(donor));

        if (
          city &&
          donorCity !== city
        ) {
          return false;
        }

        // -----------------------------------------------
        // SPECIFIC LOCATION
        // -----------------------------------------------
        //
        // Only applied when user typed something.
        // -----------------------------------------------

        const donorLocation =
          getLocation(donor);

        if (
          location &&
          !locationMatches(
            location,
            donorLocation
          )
        ) {
          return false;
        }

        // -----------------------------------------------
        // AVAILABILITY
        // -----------------------------------------------

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

    // -----------------------------------------------------
    // SORT
    // -----------------------------------------------------

    const sort =
      sortEl?.value || "available";

    if (sort === "available") {

      list.sort((a, b) => {

        const aAvailable =
          effectiveAvailable(a)
            ? 0
            : 1;

        const bAvailable =
          effectiveAvailable(b)
            ? 0
            : 1;

        if (
          aAvailable !== bAvailable
        ) {
          return (
            aAvailable -
            bAvailable
          );
        }

        return normalize(
          getName(a)
        ).localeCompare(
          normalize(getName(b))
        );
      });

    } else if (sort === "blood") {

      list.sort((a, b) =>
        normalize(
          getBlood(a)
        ).localeCompare(
          normalize(getBlood(b))
        )
      );

    } else if (sort === "location") {

      list.sort((a, b) => {

        const aLocation =
          `${getCity(a)} ${getLocation(a)}`;

        const bLocation =
          `${getCity(b)} ${getLocation(b)}`;

        return aLocation.localeCompare(
          bLocation
        );
      });

    } else if (sort === "recent") {

      list.sort((a, b) => {

        const aDate =
          parseDate(
            getVerifiedAt(a)
          )?.getTime() || 0;

        const bDate =
          parseDate(
            getVerifiedAt(b)
          )?.getTime() || 0;

        return bDate - aDate;
      });
    }

    return list;
  }

  // ---------------------------------------------------------
  // DONOR CARD
  // ---------------------------------------------------------

  function donorCard(donor) {

    const name =
      escapeHtml(
        getName(donor)
      );

    const blood =
      escapeHtml(
        getBlood(donor) || "—"
      );

    const city =
      escapeHtml(
        getCity(donor) || "—"
      );

    const location =
      escapeHtml(
        getLocation(donor) ||
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
        getLastDonation(donor)
      );

    const availableFrom =
      formatDate(
        effectiveAvailableDate(donor)
      );

    const verified =
      formatDate(
        getVerifiedAt(donor)
      );

    const phone =
      String(
        getPhone(donor)
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
          <h3>${name}</h3>

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
  // RENDER
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

    resultsEl.innerHTML =
      donors
        .map(donorCard)
        .join("");
  }

  // ---------------------------------------------------------
  // EVENTS
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
  // INITIAL LOAD
  // ---------------------------------------------------------

  loadDonors();

})();
