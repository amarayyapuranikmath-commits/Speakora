# syntax=docker/dockerfile:1
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre
# curl is only for the container health check
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home app
WORKDIR /app
COPY --from=build /build/target/platform-*.jar app.jar
USER app
EXPOSE 8080 8081
# Sized for a small host (Render Free: 512 MB, a fraction of a CPU): serial GC, quick-start compiler, 70% of the memory limit for the heap.
# Measured on the development machine (docs/PERFORMANCE.md): start-up about 12.8 s to 10.5 s, resident memory about 460 MB to 340 MB.
ENV SPRING_PROFILES_ACTIVE=prod \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -Djava.security.egd=file:/dev/urandom"
# 8081 is the private management port (health + Prometheus metrics); never publish it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD curl -fsS http://localhost:8081/actuator/health/readiness || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
